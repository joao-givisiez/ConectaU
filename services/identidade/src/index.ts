import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  Corpo,
  PAPEIS,
  criarApp,
  criarLog,
  criarPool,
  erros,
  esperar,
  exigirUsuario,
  finalizarApp,
  idDoCaminho,
  iniciar,
  transacao,
  variavel,
  variavelNumero,
  verificarBanco,
  type ClienteBanco,
  type Papel
} from "@conectau/comum";
import { conferir, gerarHash } from "./senhas.js";

const SERVICO = "identidade";
const PORTA = variavelNumero("PORT", 3101);
const CHAVE_JWT = new TextEncoder().encode(variavel("JWT_SEGREDO"));
const EMISSOR = "conectau-identidade";
const VALIDADE_HORAS = variavelNumero("JWT_VALIDADE_HORAS", 8);
const CAMPI = ["LAVRAS", "SAO_SEBASTIAO_DO_PARAISO"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const log = criarLog(SERVICO);
const pool = criarPool();

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  curso: string;
  campus: string;
  papel: Papel;
  interesses: string[];
}

const SELECT_USUARIO = `
  SELECT u.id, u.nome, u.email, u.curso, u.campus, u.papel,
         COALESCE(array_agg(i.interesse ORDER BY i.interesse) FILTER (WHERE i.interesse IS NOT NULL), '{}') AS interesses
    FROM usuarios u
    LEFT JOIN interesses i ON i.usuario_id = u.id`;

async function buscarUsuario(id: string): Promise<LinhaUsuario | undefined> {
  const { rows } = await pool.query<LinhaUsuario>(`${SELECT_USUARIO} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0];
}

async function gravarInteresses(cliente: ClienteBanco, usuarioId: string, interesses: string[]): Promise<void> {
  await cliente.query("DELETE FROM interesses WHERE usuario_id = $1", [usuarioId]);
  if (interesses.length > 0) {
    await cliente.query(
      "INSERT INTO interesses (usuario_id, interesse) SELECT $1, unnest($2::text[])",
      [usuarioId, interesses]
    );
  }
}

const app = criarApp(SERVICO, async () => {
  await verificarBanco(pool);
  return { banco: "ok" };
});

// Cadastro de estudante. O papel nunca vem do cliente.
app.post("/api/v1/usuarios", async (req, res) => {
  const corpo = new Corpo(req.body);
  const nome = corpo.texto("nome", 120);
  const email = corpo.texto("email", 200).toLowerCase();
  const senha = corpo.texto("senha", 200);
  const curso = corpo.texto("curso", 120);
  const campus = corpo.enumeracao("campus", CAMPI);
  const interesses = corpo.listaTextos("interesses") ?? [];
  if (!EMAIL.test(email)) throw erros.requisicaoInvalida("email inválido");
  if (senha.length < 8) throw erros.requisicaoInvalida("A senha deve ter ao menos 8 caracteres");

  const id = randomUUID();
  const hash = await gerarHash(senha);
  try {
    await transacao(pool, async (cliente) => {
      await cliente.query(
        "INSERT INTO usuarios (id, nome, email, senha_hash, curso, campus) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, nome, email, hash, curso, campus]
      );
      await gravarInteresses(cliente, id, interesses);
    });
  } catch (erro) {
    if ((erro as { code?: string }).code === "23505") throw erros.conflito("Já existe um usuário com este e-mail");
    throw erro;
  }
  res.status(201).location(`/api/v1/usuarios/${id}`).json(await buscarUsuario(id));
});

// Login: emite um JWT assinado com o segredo que só a Identidade conhece.
app.post("/api/v1/sessoes", async (req, res) => {
  const corpo = new Corpo(req.body);
  const email = corpo.texto("email", 200).toLowerCase();
  const senha = corpo.texto("senha", 200);
  const { rows } = await pool.query<{ id: string; nome: string; papel: Papel; senha_hash: string }>(
    "SELECT id, nome, papel, senha_hash FROM usuarios WHERE email = $1",
    [email]
  );
  const usuario = rows[0];
  if (!usuario || !(await conferir(senha, usuario.senha_hash))) {
    throw erros.naoAutenticado("E-mail ou senha incorretos");
  }
  const expiraEm = new Date(Date.now() + VALIDADE_HORAS * 3600 * 1000);
  const token = await new SignJWT({ papel: usuario.papel, nome: usuario.nome })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuario.id)
    .setIssuer(EMISSOR)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiraEm.getTime() / 1000))
    .sign(CHAVE_JWT);
  res.status(201).json({ token, expiraEm: expiraEm.toISOString(), papel: usuario.papel, usuarioId: usuario.id });
});

function exigirDono(req: Parameters<typeof exigirUsuario>[0], usuarioId: string): void {
  const usuario = exigirUsuario(req);
  if (usuario.id !== usuarioId) throw erros.acessoNegado("Só o dono pode acessar este perfil");
}

app.get("/api/v1/usuarios/:usuarioId", async (req, res) => {
  const id = idDoCaminho(req.params.usuarioId, "Usuário");
  exigirDono(req, id);
  const usuario = await buscarUsuario(id);
  if (!usuario) throw erros.naoEncontrado("Usuário não encontrado");
  res.json(usuario);
});

app.patch("/api/v1/usuarios/:usuarioId", async (req, res) => {
  const id = idDoCaminho(req.params.usuarioId, "Usuário");
  exigirDono(req, id);
  const corpo = new Corpo(req.body);
  const nome = corpo.textoOpcional("nome", 120);
  const curso = corpo.textoOpcional("curso", 120);
  const campus = corpo.enumeracaoOpcional("campus", CAMPI);
  const interesses = corpo.listaTextos("interesses");

  const encontrado = await transacao(pool, async (cliente) => {
    const { rowCount } = await cliente.query(
      `UPDATE usuarios
          SET nome = COALESCE($2, nome), curso = COALESCE($3, curso), campus = COALESCE($4, campus),
              atualizado_em = now()
        WHERE id = $1`,
      [id, nome ?? null, curso ?? null, campus ?? null]
    );
    if (rowCount === 0) return false;
    if (interesses) await gravarInteresses(cliente, id, interesses);
    return true;
  });
  if (!encontrado) throw erros.naoEncontrado("Usuário não encontrado");
  res.json(await buscarUsuario(id));
});

/**
 * Verificação de token para o gateway (Traefik ForwardAuth).
 * - Sem token: 200 sem cabeçalhos de usuário (acesso anônimo às rotas públicas).
 * - Token válido: 200 com X-Usuario-Id e X-Usuario-Papel, que o gateway repassa ao BFF.
 * - Token inválido ou expirado: 401. Papel insuficiente para ?papel=ADMIN: 403.
 */
app.get("/internal/autenticacao", async (req, res) => {
  const papelExigido = typeof req.query.papel === "string" ? req.query.papel : undefined;
  if (papelExigido !== undefined && !(PAPEIS as readonly string[]).includes(papelExigido)) {
    throw erros.requisicaoInvalida("papel inválido");
  }
  const autorizacao = req.header("authorization") ?? "";
  const [esquema, token] = autorizacao.split(" ");

  if (!token || esquema?.toLowerCase() !== "bearer") {
    if (papelExigido) throw erros.naoAutenticado();
    res.status(200).end();
    return;
  }

  let sub: string | undefined;
  let papel: unknown;
  try {
    const { payload } = await jwtVerify(token, CHAVE_JWT, { issuer: EMISSOR, algorithms: ["HS256"] });
    sub = payload.sub;
    papel = payload.papel;
  } catch {
    throw erros.naoAutenticado("Token inválido ou expirado");
  }
  if (!sub || (papel !== "ESTUDANTE" && papel !== "ADMIN")) throw erros.naoAutenticado("Token inválido");
  if (papelExigido && papel !== papelExigido) throw erros.acessoNegado(`Rota exclusiva de ${papelExigido}`);

  res.setHeader("X-Usuario-Id", sub);
  res.setHeader("X-Usuario-Papel", papel);
  res.status(200).end();
});

finalizarApp(app, SERVICO);

/** Cria o administrador inicial a partir do Secret (ADMIN_EMAIL / ADMIN_SENHA), se ainda não existir. */
async function criarAdministrador(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA;
  if (!email || !senha) return;
  for (;;) {
    try {
      const existente = await pool.query("SELECT 1 FROM usuarios WHERE email = $1", [email]);
      if (existente.rowCount === 0) {
        await pool.query(
          `INSERT INTO usuarios (id, nome, email, senha_hash, curso, campus, papel)
           VALUES ($1, 'Administrador ConectaU', $2, $3, 'Equipe ConectaU', 'LAVRAS', 'ADMIN')
           ON CONFLICT (email) DO NOTHING`,
          [randomUUID(), email, await gerarHash(senha)]
        );
        log.info("Administrador inicial criado", { email });
      }
      return;
    } catch (erro) {
      log.aviso("Banco ainda indisponível para criar o administrador; nova tentativa em 3 s", {
        erro: (erro as Error).message
      });
      await esperar(3000);
    }
  }
}

iniciar(app, PORTA, SERVICO, () => pool.end());
void criarAdministrador();
