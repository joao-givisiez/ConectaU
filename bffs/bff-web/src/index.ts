import type { Request, Response } from "express";
import {
  cabecalhosDoUsuario,
  chamar,
  criarApp,
  criarLog,
  exigirUsuario,
  finalizarApp,
  idDoCaminho,
  iniciar,
  requestIdDe,
  usuarioOpcional,
  variavel,
  variavelNumero,
  type Usuario
} from "@conectau/comum";

/**
 * BFF do Portal Web (comunidade, mobile-first). Não tem banco nem regra de negócio:
 * agrega serviços e entrega cards compactos. O gateway remove o prefixo /web antes de chegar aqui.
 */

const SERVICO = "bff-web";
const PORTA = variavelNumero("PORT", 3201);
const URL = {
  identidade: variavel("IDENTIDADE_URL"),
  oportunidades: variavel("OPORTUNIDADES_URL"),
  engajamento: variavel("ENGAJAMENTO_URL"),
  assistente: variavel("ASSISTENTE_URL")
};
const log = criarLog(SERVICO);

interface Link {
  href: string;
  method: string;
}

interface Oportunidade {
  id: string;
  titulo: string;
  descricao?: string;
  categoria: string;
  campus: string;
  dataInicio?: string;
  prazoInscricao: string;
  fonteUrl: string;
  tags: string[];
  status: string;
  _links: Record<string, Link>;
}

interface Lista<T> {
  itens: T[];
  pagina: number;
  limite: number;
  total: number;
}

interface Perfil {
  campus: string;
  interesses: string[];
}

const DIA = 24 * 3600 * 1000;

/** Reescreve os links do serviço para as rotas que o Portal Web usa e remove ações administrativas. */
function linksDoPortal(links: Record<string, Link>): Record<string, Link> {
  const resultado: Record<string, Link> = {};
  for (const [relacao, link] of Object.entries(links)) {
    if (["publicar", "encerrar", "editar", "excluir"].includes(relacao)) continue;
    resultado[relacao] = { ...link, href: link.href.replace(/^\/api\/v1\//, "/web/") };
  }
  return resultado;
}

/** Card compacto: o que cabe numa tela de celular. */
function card(o: Oportunidade, favoritos?: Map<string, string>) {
  return {
    id: o.id,
    titulo: o.titulo,
    quando: o.dataInicio?.slice(0, 10),
    campus: o.campus,
    categoria: o.categoria,
    ...(favoritos ? { salvo: favoritos.has(o.id) } : {}),
    prazoEmDias: Math.max(0, Math.ceil((new Date(o.prazoInscricao).getTime() - Date.now()) / DIA)),
    _links: { self: { href: `/web/oportunidades/${o.id}`, method: "GET" } }
  };
}

function opcoes(res: Response, usuario: Usuario | undefined, timeoutMs = 3000) {
  return { cabecalhos: cabecalhosDoUsuario(usuario), requestId: requestIdDe(res), timeoutMs };
}

/** Favoritos do usuário (oportunidadeId → favoritoId). Se o Engajamento falhar, devolve undefined (degrada). */
async function favoritosDe(usuario: Usuario | undefined, res: Response): Promise<Map<string, string> | undefined> {
  if (!usuario) return undefined;
  try {
    const { corpo } = await chamar<Lista<{ id: string; oportunidadeId: string }>>(
      `${URL.engajamento}/api/v1/favoritos?limite=100`,
      opcoes(res, usuario, 2000)
    );
    return new Map(corpo.itens.map((f) => [f.oportunidadeId, f.id]));
  } catch (erro) {
    log.aviso("Engajamento indisponível; feed sem o campo 'salvo'", { erro: (erro as Error).message });
    return undefined;
  }
}

async function perfilDe(usuario: Usuario | undefined, res: Response): Promise<Perfil | undefined> {
  if (!usuario) return undefined;
  try {
    const { corpo } = await chamar<Perfil>(`${URL.identidade}/api/v1/usuarios/${usuario.id}`, opcoes(res, usuario, 2000));
    return corpo;
  } catch {
    return undefined;
  }
}

function buscaOportunidades(parametros: URLSearchParams, res: Response, usuario: Usuario | undefined) {
  return chamar<Lista<Oportunidade>>(`${URL.oportunidades}/api/v1/oportunidades?${parametros}`, opcoes(res, usuario));
}

/** Repassa a requisição a um serviço com a identidade do usuário (e a query string original). */
async function repassar(req: Request, res: Response, base: string, caminho: string, timeoutMs = 5000) {
  const usuario = exigirUsuario(req);
  const indice = req.originalUrl.indexOf("?");
  const query = indice >= 0 ? req.originalUrl.slice(indice) : "";
  const temCorpo = ["POST", "PUT", "PATCH"].includes(req.method);
  const resposta = await chamar(`${base}${caminho}${query}`, {
    ...opcoes(res, usuario, timeoutMs),
    metodo: req.method,
    ...(temCorpo ? { corpo: req.body ?? {} } : {})
  });
  if (resposta.status === 204) res.status(204).end();
  else res.status(resposta.status).json(resposta.corpo);
}

const app = criarApp(SERVICO);

/** Feed personalizado: filtra pelo campus e pelos interesses do perfil e marca o que já foi salvo. */
app.get("/feed", async (req, res) => {
  const usuario = usuarioOpcional(req);
  const pagina = typeof req.query.pagina === "string" ? req.query.pagina : "1";
  const [perfil, favoritos] = await Promise.all([perfilDe(usuario, res), favoritosDe(usuario, res)]);

  const parametros = new URLSearchParams({ limite: "10", pagina });
  if (perfil?.campus) parametros.set("campus", perfil.campus);
  let interesses = perfil?.interesses ?? [];
  if (interesses.length) parametros.set("tags", interesses.join(","));

  let { corpo } = await buscaOportunidades(parametros, res, usuario);
  if (corpo.total === 0 && interesses.length) {
    // Nada com esses interesses: mostra o que há no campus, em vez de um feed vazio.
    parametros.delete("tags");
    interesses = [];
    ({ corpo } = await buscaOportunidades(parametros, res, usuario));
  }
  res.json({
    itens: corpo.itens.map((o) => card(o, favoritos)),
    pagina: corpo.pagina,
    limite: corpo.limite,
    total: corpo.total,
    filtro: { campus: perfil?.campus, interesses }
  });
});

app.get("/oportunidades", async (req, res) => {
  const usuario = usuarioOpcional(req);
  const parametros = new URLSearchParams({ limite: "10" });
  for (const campo of ["busca", "campus", "categoria", "tags", "pagina"]) {
    const valor = req.query[campo];
    if (typeof valor === "string" && valor !== "") parametros.set(campo, valor);
  }
  const [{ corpo }, favoritos] = await Promise.all([
    buscaOportunidades(parametros, res, usuario),
    favoritosDe(usuario, res)
  ]);
  res.json({ itens: corpo.itens.map((o) => card(o, favoritos)), pagina: corpo.pagina, limite: corpo.limite, total: corpo.total });
});

app.get("/oportunidades/:id", async (req, res) => {
  const usuario = usuarioOpcional(req);
  const id = idDoCaminho(req.params.id, "Oportunidade");
  const [{ corpo: o }, favoritos] = await Promise.all([
    chamar<Oportunidade>(`${URL.oportunidades}/api/v1/oportunidades/${id}`, opcoes(res, usuario)),
    favoritosDe(usuario, res)
  ]);
  if (o.status !== "PUBLICADA") {
    res.status(404).json({ codigo: "RECURSO_NAO_ENCONTRADO", mensagem: "Oportunidade não encontrada" });
    return;
  }
  res.json({
    id: o.id,
    titulo: o.titulo,
    descricao: o.descricao,
    categoria: o.categoria,
    campus: o.campus,
    dataInicio: o.dataInicio,
    prazoInscricao: o.prazoInscricao,
    prazoEmDias: Math.max(0, Math.ceil((new Date(o.prazoInscricao).getTime() - Date.now()) / DIA)),
    tags: o.tags,
    ...(favoritos ? { salvo: favoritos.has(o.id), favoritoId: favoritos.get(o.id) } : {}),
    _links: linksDoPortal(o._links)
  });
});

// Perfil (a identidade vem do token; nunca de um id na URL).
app.get("/perfil", async (req, res) => {
  const usuario = exigirUsuario(req);
  await repassar(req, res, URL.identidade, `/api/v1/usuarios/${usuario.id}`);
});
app.patch("/perfil", async (req, res) => {
  const usuario = exigirUsuario(req);
  await repassar(req, res, URL.identidade, `/api/v1/usuarios/${usuario.id}`);
});

// Engajamento: favoritos, lembretes e avisos.
app.get("/favoritos", (req, res) => repassar(req, res, URL.engajamento, "/api/v1/favoritos"));
app.post("/favoritos", (req, res) => repassar(req, res, URL.engajamento, "/api/v1/favoritos"));
app.delete("/favoritos/:id", (req, res) =>
  repassar(req, res, URL.engajamento, `/api/v1/favoritos/${idDoCaminho(req.params.id, "Favorito")}`)
);
app.get("/lembretes", (req, res) => repassar(req, res, URL.engajamento, "/api/v1/lembretes"));
app.post("/lembretes", (req, res) => repassar(req, res, URL.engajamento, "/api/v1/lembretes"));
app.delete("/lembretes/:id", (req, res) =>
  repassar(req, res, URL.engajamento, `/api/v1/lembretes/${idDoCaminho(req.params.id, "Lembrete")}`)
);
app.get("/notificacoes", (req, res) => repassar(req, res, URL.engajamento, "/api/v1/notificacoes"));
app.patch("/notificacoes/:id", (req, res) =>
  repassar(req, res, URL.engajamento, `/api/v1/notificacoes/${idDoCaminho(req.params.id, "Notificação")}`)
);

// Assistente de editais (limite de requisições mais restrito no gateway).
app.post("/conversas", (req, res) => repassar(req, res, URL.assistente, "/api/v1/conversas"));
app.post("/conversas/:id/mensagens", (req, res) =>
  repassar(req, res, URL.assistente, `/api/v1/conversas/${idDoCaminho(req.params.id, "Conversa")}/mensagens`, 15000)
);

finalizarApp(app, SERVICO);
iniciar(app, PORTA, SERVICO);
