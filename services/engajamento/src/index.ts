import { randomUUID } from "node:crypto";
import {
  Consumidor,
  Corpo,
  ErroChamada,
  chamar,
  criarApp,
  criarLog,
  criarPool,
  erros,
  exigirUsuario,
  finalizarApp,
  idDoCaminho,
  iniciar,
  paginacao,
  requestIdDe,
  transacao,
  variavel,
  variavelNumero,
  verificarBanco,
  type Evento,
  type Usuario
} from "@conectau/comum";

const SERVICO = "engajamento";
const PORTA = variavelNumero("PORT", 3104);
const OPORTUNIDADES_URL = variavel("OPORTUNIDADES_URL");
const log = criarLog(SERVICO);
const pool = criarPool();

const consumidor = new Consumidor({
  url: variavel("RABBITMQ_URL"),
  servico: SERVICO,
  fila: "engajamento.oportunidades",
  chaves: ["oportunidade.publicada", "oportunidade.editada", "oportunidade.encerrada"]
});

interface Resumo {
  id: string;
  titulo: string;
  prazo_inscricao: Date;
  status: string;
  versao: number;
}

// ---------- Cópia local da oportunidade ----------

/**
 * Lê a cópia local; se o evento ainda não chegou (consistência eventual),
 * consulta a API pública de Oportunidades e guarda o resultado.
 */
async function obterResumo(oportunidadeId: string, requestId: string): Promise<Resumo> {
  const local = await pool.query<Resumo>(
    "SELECT id, titulo, prazo_inscricao, status, versao FROM oportunidade_resumo WHERE id = $1",
    [oportunidadeId]
  );
  if (local.rows[0]) return local.rows[0];
  try {
    const { corpo } = await chamar<{ id: string; titulo: string; prazoInscricao: string; status: string }>(
      `${OPORTUNIDADES_URL}/api/v1/oportunidades/${oportunidadeId}`,
      { requestId, timeoutMs: 3000 }
    );
    const resumo: Resumo = {
      id: corpo.id,
      titulo: corpo.titulo,
      prazo_inscricao: new Date(corpo.prazoInscricao),
      status: corpo.status,
      versao: 0
    };
    await pool.query(
      `INSERT INTO oportunidade_resumo (id, titulo, prazo_inscricao, status, versao)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [resumo.id, resumo.titulo, resumo.prazo_inscricao, resumo.status, resumo.versao]
    );
    return resumo;
  } catch (erro) {
    if (erro instanceof ErroChamada && erro.status === 404) throw erros.naoEncontrado("Oportunidade não encontrada");
    throw erro;
  }
}

// ---------- Representações ----------

function favoritoParaJson(linha: {
  id: string;
  usuario_id: string;
  oportunidade_id: string;
  criado_em: Date;
  titulo: string | null;
  prazo_inscricao: Date | null;
  status: string | null;
}) {
  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    oportunidadeId: linha.oportunidade_id,
    criadoEm: linha.criado_em.toISOString(),
    oportunidade: linha.titulo
      ? { titulo: linha.titulo, prazoInscricao: linha.prazo_inscricao?.toISOString(), status: linha.status }
      : undefined
  };
}

function lembreteParaJson(linha: {
  id: string;
  usuario_id: string;
  oportunidade_id: string;
  antecedencia_horas: number;
  disparar_em: Date;
  estado: string;
  criado_em: Date;
}) {
  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    oportunidadeId: linha.oportunidade_id,
    antecedenciaHoras: linha.antecedencia_horas,
    dispararEm: linha.disparar_em.toISOString(),
    estado: linha.estado,
    criadoEm: linha.criado_em.toISOString()
  };
}

function notificacaoParaJson(linha: {
  id: string;
  usuario_id: string;
  oportunidade_id: string | null;
  tipo: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criada_em: Date;
}) {
  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    oportunidadeId: linha.oportunidade_id ?? undefined,
    tipo: linha.tipo,
    titulo: linha.titulo,
    mensagem: linha.mensagem,
    lida: linha.lida,
    criadaEm: linha.criada_em.toISOString()
  };
}

/** Recursos pessoais: o dono vem sempre do token (cabeçalho do gateway), nunca da URL. */
async function exigirDono(tabela: "favoritos" | "lembretes" | "notificacoes", id: string, usuario: Usuario) {
  const { rows } = await pool.query<{ usuario_id: string }>(`SELECT usuario_id FROM ${tabela} WHERE id = $1`, [id]);
  const linha = rows[0];
  if (!linha) throw erros.naoEncontrado("Recurso não encontrado");
  if (linha.usuario_id !== usuario.id) throw erros.acessoNegado("O recurso pertence a outro usuário");
}

// ---------- API ----------

const app = criarApp(SERVICO, async () => {
  await verificarBanco(pool);
  return { banco: "ok", rabbitmq: consumidor.conectado ? "conectado" : "desconectado" };
});

app.get("/api/v1/favoritos", async (req, res) => {
  const usuario = exigirUsuario(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const [itens, total] = await Promise.all([
    pool.query(
      `SELECT f.id, f.usuario_id, f.oportunidade_id, f.criado_em, r.titulo, r.prazo_inscricao, r.status
         FROM favoritos f LEFT JOIN oportunidade_resumo r ON r.id = f.oportunidade_id
        WHERE f.usuario_id = $1 ORDER BY f.criado_em DESC LIMIT $2 OFFSET $3`,
      [usuario.id, limite, offset]
    ),
    pool.query<{ total: string }>("SELECT count(*) AS total FROM favoritos WHERE usuario_id = $1", [usuario.id])
  ]);
  res.json({ itens: itens.rows.map(favoritoParaJson), pagina, limite, total: Number(total.rows[0]?.total ?? 0) });
});

app.post("/api/v1/favoritos", async (req, res) => {
  const usuario = exigirUsuario(req);
  const oportunidadeId = new Corpo(req.body).uuid("oportunidadeId");
  const resumo = await obterResumo(oportunidadeId, requestIdDe(res));
  if (resumo.status !== "PUBLICADA") throw erros.regraDeNegocio("Só é possível salvar oportunidades publicadas");
  const id = randomUUID();
  try {
    await pool.query("INSERT INTO favoritos (id, usuario_id, oportunidade_id) VALUES ($1, $2, $3)", [
      id,
      usuario.id,
      oportunidadeId
    ]);
  } catch (erro) {
    if ((erro as { code?: string }).code === "23505") throw erros.conflito("Oportunidade já está nos favoritos");
    throw erro;
  }
  res
    .status(201)
    .location(`/api/v1/favoritos/${id}`)
    .json({
      id,
      usuarioId: usuario.id,
      oportunidadeId,
      criadoEm: new Date().toISOString(),
      oportunidade: { titulo: resumo.titulo, prazoInscricao: resumo.prazo_inscricao.toISOString(), status: resumo.status }
    });
});

app.delete("/api/v1/favoritos/:favoritoId", async (req, res) => {
  const usuario = exigirUsuario(req);
  const id = idDoCaminho(req.params.favoritoId, "Favorito");
  await exigirDono("favoritos", id, usuario);
  await pool.query("DELETE FROM favoritos WHERE id = $1", [id]);
  res.status(204).end();
});

app.get("/api/v1/lembretes", async (req, res) => {
  const usuario = exigirUsuario(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const [itens, total] = await Promise.all([
    pool.query(
      "SELECT * FROM lembretes WHERE usuario_id = $1 ORDER BY disparar_em ASC LIMIT $2 OFFSET $3",
      [usuario.id, limite, offset]
    ),
    pool.query<{ total: string }>("SELECT count(*) AS total FROM lembretes WHERE usuario_id = $1", [usuario.id])
  ]);
  res.json({ itens: itens.rows.map(lembreteParaJson), pagina, limite, total: Number(total.rows[0]?.total ?? 0) });
});

app.post("/api/v1/lembretes", async (req, res) => {
  const usuario = exigirUsuario(req);
  const corpo = new Corpo(req.body);
  const oportunidadeId = corpo.uuid("oportunidadeId");
  const antecedenciaHoras = corpo.inteiroOpcional("antecedenciaHoras", 1, 720) ?? 48;
  const resumo = await obterResumo(oportunidadeId, requestIdDe(res));
  if (resumo.status === "ENCERRADA") throw erros.regraDeNegocio("A oportunidade já foi encerrada");
  if (resumo.prazo_inscricao.getTime() <= Date.now()) throw erros.regraDeNegocio("O prazo de inscrição já passou");
  const dispararEm = new Date(Math.max(Date.now(), resumo.prazo_inscricao.getTime() - antecedenciaHoras * 3600 * 1000));
  const id = randomUUID();
  try {
    const { rows } = await pool.query(
      `INSERT INTO lembretes (id, usuario_id, oportunidade_id, antecedencia_horas, disparar_em)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, usuario.id, oportunidadeId, antecedenciaHoras, dispararEm]
    );
    res.status(201).location(`/api/v1/lembretes/${id}`).json(lembreteParaJson(rows[0]));
  } catch (erro) {
    if ((erro as { code?: string }).code === "23505") throw erros.conflito("Já existe um lembrete para esta oportunidade");
    throw erro;
  }
});

app.delete("/api/v1/lembretes/:lembreteId", async (req, res) => {
  const usuario = exigirUsuario(req);
  const id = idDoCaminho(req.params.lembreteId, "Lembrete");
  await exigirDono("lembretes", id, usuario);
  await pool.query("DELETE FROM lembretes WHERE id = $1", [id]);
  res.status(204).end();
});

app.get("/api/v1/notificacoes", async (req, res) => {
  const usuario = exigirUsuario(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const parametros: unknown[] = [usuario.id];
  let filtro = "";
  if (req.query.lida === "true" || req.query.lida === "false") {
    parametros.push(req.query.lida === "true");
    filtro = " AND lida = $2";
  }
  const [itens, total] = await Promise.all([
    pool.query(
      `SELECT * FROM notificacoes WHERE usuario_id = $1${filtro} ORDER BY criada_em DESC
        LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
      [...parametros, limite, offset]
    ),
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM notificacoes WHERE usuario_id = $1${filtro}`, parametros)
  ]);
  res.json({ itens: itens.rows.map(notificacaoParaJson), pagina, limite, total: Number(total.rows[0]?.total ?? 0) });
});

app.get("/api/v1/notificacoes/:notificacaoId", async (req, res) => {
  const usuario = exigirUsuario(req);
  const id = idDoCaminho(req.params.notificacaoId, "Notificação");
  await exigirDono("notificacoes", id, usuario);
  const { rows } = await pool.query("SELECT * FROM notificacoes WHERE id = $1", [id]);
  res.json(notificacaoParaJson(rows[0]));
});

app.patch("/api/v1/notificacoes/:notificacaoId", async (req, res) => {
  const usuario = exigirUsuario(req);
  const id = idDoCaminho(req.params.notificacaoId, "Notificação");
  if (new Corpo(req.body).booleano("lida") !== true) throw erros.requisicaoInvalida("Só é possível marcar como lida");
  await exigirDono("notificacoes", id, usuario);
  const { rows } = await pool.query("UPDATE notificacoes SET lida = true WHERE id = $1 RETURNING *", [id]);
  res.json(notificacaoParaJson(rows[0]));
});

finalizarApp(app, SERVICO);

// ---------- Consumo de eventos de Oportunidades ----------

interface RetratoOportunidade {
  id: string;
  titulo: string;
  prazoInscricao: string;
  status: string;
  versao: number;
}

const formatarData = (data: Date) =>
  data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

async function tratarEvento(evento: Evento): Promise<void> {
  const o = evento.payload as unknown as RetratoOportunidade;
  await transacao(pool, async (cliente) => {
    // Idempotência: a mesma mensagem entregue duas vezes só é processada uma vez.
    const nova = await cliente.query(
      "INSERT INTO mensagens_processadas (message_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [evento.messageId]
    );
    if (nova.rowCount === 0) return;

    const anterior = (
      await cliente.query<Resumo>("SELECT * FROM oportunidade_resumo WHERE id = $1 FOR UPDATE", [o.id])
    ).rows[0];
    if (anterior && anterior.versao >= o.versao) return; // evento antigo, fora de ordem

    const status = evento.tipo === "OportunidadeEncerrada" ? "ENCERRADA" : o.status;
    const prazo = new Date(o.prazoInscricao);
    await cliente.query(
      `INSERT INTO oportunidade_resumo (id, titulo, prazo_inscricao, status, versao, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET titulo = $2, prazo_inscricao = $3, status = $4, versao = $5, atualizado_em = now()`,
      [o.id, o.titulo, prazo, status, o.versao]
    );

    if (evento.tipo === "OportunidadeEditada" && anterior && anterior.prazo_inscricao.getTime() !== prazo.getTime()) {
      await cliente.query(
        `UPDATE lembretes SET disparar_em = GREATEST(now(), $2::timestamptz - make_interval(hours => antecedencia_horas))
          WHERE oportunidade_id = $1 AND estado = 'AGENDADO'`,
        [o.id, prazo]
      );
      await avisarQuemFavoritou(
        cliente,
        o.id,
        "OPORTUNIDADE_ALTERADA",
        "Prazo alterado",
        `O prazo de inscrição de "${o.titulo}" mudou para ${formatarData(prazo)}.`
      );
    }
    if (evento.tipo === "OportunidadeEncerrada") {
      await cliente.query("UPDATE lembretes SET estado = 'CANCELADO' WHERE oportunidade_id = $1 AND estado = 'AGENDADO'", [o.id]);
      await avisarQuemFavoritou(cliente, o.id, "OPORTUNIDADE_ENCERRADA", "Oportunidade encerrada", `"${o.titulo}" foi encerrada.`);
    }
  });
  log.info(`${evento.tipo} aplicado`, { oportunidadeId: o.id, versao: o.versao });
}

async function avisarQuemFavoritou(
  cliente: Parameters<Parameters<typeof transacao>[1]>[0],
  oportunidadeId: string,
  tipo: string,
  titulo: string,
  mensagem: string
): Promise<void> {
  await cliente.query(
    `INSERT INTO notificacoes (id, usuario_id, oportunidade_id, tipo, titulo, mensagem)
     SELECT gen_random_uuid(), usuario_id, oportunidade_id, $2, $3, $4 FROM favoritos WHERE oportunidade_id = $1`,
    [oportunidadeId, tipo, titulo, mensagem]
  );
}

/** Dispara os lembretes vencidos, gerando avisos PRAZO_PROXIMO. Seguro com várias réplicas (SKIP LOCKED). */
async function dispararLembretes(): Promise<void> {
  const { rowCount } = await pool.query(
    `WITH disparados AS (
       UPDATE lembretes SET estado = 'DISPARADO'
        WHERE id IN (SELECT id FROM lembretes WHERE estado = 'AGENDADO' AND disparar_em <= now()
                      ORDER BY disparar_em LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING usuario_id, oportunidade_id
     )
     INSERT INTO notificacoes (id, usuario_id, oportunidade_id, tipo, titulo, mensagem)
     SELECT gen_random_uuid(), d.usuario_id, d.oportunidade_id, 'PRAZO_PROXIMO', 'Prazo de inscrição se aproximando',
            'As inscrições para "' || r.titulo || '" encerram em ' ||
            to_char(r.prazo_inscricao AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '.'
       FROM disparados d JOIN oportunidade_resumo r ON r.id = d.oportunidade_id`
  );
  if (rowCount) log.info(`${rowCount} lembrete(s) disparado(s)`);
}

consumidor.iniciar(tratarEvento);
const temporizador = setInterval(() => void dispararLembretes().catch(() => undefined), 30000);

iniciar(app, PORTA, SERVICO, async () => {
  clearInterval(temporizador);
  await consumidor.fechar();
  await pool.end();
});
