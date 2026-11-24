import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { MongoClient, type Collection, type Filter } from "mongodb";
import {
  Corpo,
  chamar,
  criarApp,
  criarLog,
  erros,
  exigirAdmin,
  exigirTokenServico,
  finalizarApp,
  idDoCaminho,
  iniciar,
  paginacao,
  textoDaQuery,
  variavel,
  variavelNumero
} from "@conectau/comum";
import { itensDeExemplo, type ItemColetado } from "./exemplo.js";

const SERVICO = "coleta";
const PORTA = variavelNumero("PORT", 3102);
const TOKEN_SERVICO = variavel("TOKEN_SERVICO");
const INTERVALO_MINUTOS = variavelNumero("COLETA_INTERVALO_MINUTOS", 60);

const STATUS = ["PENDENTE", "CONSUMIDO", "DESCARTADO", "DUPLICADO"] as const;
const ORIGENS = ["COLETA", "MANUAL"] as const;
const TIPOS_FONTE = ["EXEMPLO", "JSON"] as const;
type Status = (typeof STATUS)[number];
type Origem = (typeof ORIGENS)[number];
type TipoFonte = (typeof TIPOS_FONTE)[number];

interface DocFonte {
  _id: string;
  nome: string;
  url: string;
  tipo: TipoFonte;
  periodicidadeCron: string;
  ativa: boolean;
  ultimaExecucaoEm?: Date;
  criadaEm: Date;
}

interface DocExecucao {
  _id: string;
  fonteId: string;
  iniciadaEm: Date;
  finalizadaEm?: Date;
  estado: "EM_ANDAMENTO" | "CONCLUIDA" | "FALHA";
  itensEncontrados: number;
  itensNovos: number;
  itensDuplicados: number;
  erro?: string;
}

interface DocCandidato {
  _id: string;
  origem: Origem;
  fonteId?: string;
  urlOrigem: string;
  tituloExtraido: string;
  descricaoExtraida?: string;
  dataExtraida?: Date;
  solicitante?: string;
  status: Status;
  sagaId?: string;
  hash: string;
  scoreDuplicidade: number;
  bruto?: unknown;
  coletadoEm: Date;
  atualizadoEm: Date;
}

const log = criarLog(SERVICO);
const mongo = new MongoClient(variavel("MONGO_URL"), { serverSelectionTimeoutMS: 3000 });
const banco = mongo.db(variavel("MONGO_BANCO", "coleta"));
const fontes: Collection<DocFonte> = banco.collection("fontes");
const execucoes: Collection<DocExecucao> = banco.collection("execucoes");
const candidatos: Collection<DocCandidato> = banco.collection("candidatos");

// ---------- Representações ----------

function fonteParaJson(f: DocFonte) {
  return {
    id: f._id,
    nome: f.nome,
    url: f.url,
    tipo: f.tipo,
    periodicidadeCron: f.periodicidadeCron,
    ativa: f.ativa,
    ultimaExecucaoEm: f.ultimaExecucaoEm?.toISOString()
  };
}

function execucaoParaJson(e: DocExecucao) {
  return {
    id: e._id,
    fonteId: e.fonteId,
    iniciadaEm: e.iniciadaEm.toISOString(),
    finalizadaEm: e.finalizadaEm?.toISOString(),
    estado: e.estado,
    itensEncontrados: e.itensEncontrados,
    itensNovos: e.itensNovos,
    itensDuplicados: e.itensDuplicados,
    erro: e.erro
  };
}

function candidatoParaJson(c: DocCandidato) {
  return {
    id: c._id,
    origem: c.origem,
    fonteId: c.fonteId,
    urlOrigem: c.urlOrigem,
    tituloExtraido: c.tituloExtraido,
    descricaoExtraida: c.descricaoExtraida,
    dataExtraida: c.dataExtraida?.toISOString(),
    solicitante: c.solicitante,
    status: c.status,
    sagaId: c.sagaId,
    scoreDuplicidade: c.scoreDuplicidade,
    coletadoEm: c.coletadoEm.toISOString()
  };
}

// ---------- Deduplicação ----------

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mesmo título (normalizado) na mesma data = mesmo candidato. */
function hashCandidato(titulo: string, data?: Date): string {
  const dia = data ? data.toISOString().slice(0, 10) : "sem-data";
  return createHash("sha256").update(`${normalizar(titulo)}|${dia}`).digest("hex");
}

/** Similaridade de Jaccard entre as palavras do título e as dos candidatos recentes (0 a 1). */
async function scoreDuplicidade(titulo: string): Promise<number> {
  const palavras = new Set(normalizar(titulo).split(" ").filter((p) => p.length > 2));
  if (palavras.size === 0) return 0;
  const recentes = await candidatos
    .find({}, { projection: { tituloExtraido: 1 } })
    .sort({ coletadoEm: -1 })
    .limit(200)
    .toArray();
  let maior = 0;
  for (const outro of recentes) {
    const outras = new Set(normalizar(outro.tituloExtraido).split(" ").filter((p) => p.length > 2));
    const comuns = [...palavras].filter((p) => outras.has(p)).length;
    const uniao = new Set([...palavras, ...outras]).size;
    if (uniao > 0) maior = Math.max(maior, comuns / uniao);
  }
  return Math.round(maior * 100) / 100;
}

function ehChaveDuplicada(erro: unknown): boolean {
  return (erro as { code?: number }).code === 11000;
}

// ---------- Coletor ----------

async function obterItens(fonte: DocFonte): Promise<ItemColetado[]> {
  if (fonte.tipo === "EXEMPLO") return itensDeExemplo();
  const { corpo } = await chamar<unknown>(fonte.url, { timeoutMs: 10000 });
  if (!Array.isArray(corpo)) throw new Error("A fonte JSON deve devolver uma lista de itens");
  return corpo
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => typeof item.titulo === "string" && typeof item.url === "string")
    .map((item) => ({
      titulo: String(item.titulo),
      descricao: typeof item.descricao === "string" ? item.descricao : "",
      url: String(item.url),
      ...(typeof item.data === "string" ? { data: item.data } : {})
    }));
}

/** Executa uma coleta: busca itens, normaliza, descarta duplicados e cria candidatos PENDENTES. */
async function executarColeta(fonte: DocFonte): Promise<DocExecucao> {
  const execucao: DocExecucao = {
    _id: randomUUID(),
    fonteId: fonte._id,
    iniciadaEm: new Date(),
    estado: "EM_ANDAMENTO",
    itensEncontrados: 0,
    itensNovos: 0,
    itensDuplicados: 0
  };
  await execucoes.insertOne(execucao);
  try {
    const itens = await obterItens(fonte);
    execucao.itensEncontrados = itens.length;
    for (const item of itens) {
      const data = item.data ? new Date(item.data) : undefined;
      const dataValida = data && !Number.isNaN(data.getTime()) ? data : undefined;
      const agora = new Date();
      const candidato: DocCandidato = {
        _id: randomUUID(),
        origem: "COLETA",
        fonteId: fonte._id,
        urlOrigem: item.url,
        tituloExtraido: item.titulo.trim(),
        descricaoExtraida: item.descricao.trim(),
        ...(dataValida ? { dataExtraida: dataValida } : {}),
        status: "PENDENTE",
        hash: hashCandidato(item.titulo, dataValida),
        scoreDuplicidade: await scoreDuplicidade(item.titulo),
        bruto: item,
        coletadoEm: agora,
        atualizadoEm: agora
      };
      try {
        await candidatos.insertOne(candidato);
        execucao.itensNovos++;
      } catch (erro) {
        if (!ehChaveDuplicada(erro)) throw erro;
        execucao.itensDuplicados++;
      }
    }
    execucao.estado = "CONCLUIDA";
  } catch (erro) {
    execucao.estado = "FALHA";
    execucao.erro = (erro as Error).message;
    log.aviso("Falha na coleta", { fonte: fonte.nome, erro: execucao.erro });
  }
  execucao.finalizadaEm = new Date();
  await execucoes.replaceOne({ _id: execucao._id }, execucao);
  await fontes.updateOne({ _id: fonte._id }, { $set: { ultimaExecucaoEm: execucao.finalizadaEm } });
  log.info("Coleta finalizada", {
    fonte: fonte.nome,
    estado: execucao.estado,
    novos: execucao.itensNovos,
    duplicados: execucao.itensDuplicados
  });
  return execucao;
}

// ---------- API pública (ADMIN) ----------

const app = criarApp(SERVICO, async () => {
  await banco.command({ ping: 1 });
  return { banco: "ok" };
});

app.get("/api/v1/fontes", async (req, res) => {
  exigirAdmin(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const [itens, total] = await Promise.all([
    fontes.find().sort({ criadaEm: 1 }).skip(offset).limit(limite).toArray(),
    fontes.countDocuments()
  ]);
  res.json({ itens: itens.map(fonteParaJson), pagina, limite, total });
});

app.post("/api/v1/fontes", async (req, res) => {
  exigirAdmin(req);
  const corpo = new Corpo(req.body);
  const fonte: DocFonte = {
    _id: randomUUID(),
    nome: corpo.texto("nome", 120),
    url: corpo.url("url"),
    tipo: corpo.enumeracaoOpcional("tipo", TIPOS_FONTE) ?? "JSON",
    periodicidadeCron: corpo.texto("periodicidadeCron", 60),
    ativa: corpo.tem("ativa") ? corpo.booleano("ativa") : true,
    criadaEm: new Date()
  };
  try {
    await fontes.insertOne(fonte);
  } catch (erro) {
    if (ehChaveDuplicada(erro)) throw erros.conflito("Já existe uma fonte com esta URL");
    throw erro;
  }
  res.status(201).location(`/api/v1/fontes/${fonte._id}`).json(fonteParaJson(fonte));
});

app.get("/api/v1/execucoes", async (req, res) => {
  exigirAdmin(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const filtro: Filter<DocExecucao> = {};
  const fonteId = textoDaQuery(req.query.fonteId);
  if (fonteId) filtro.fonteId = fonteId;
  const [itens, total] = await Promise.all([
    execucoes.find(filtro).sort({ iniciadaEm: -1 }).skip(offset).limit(limite).toArray(),
    execucoes.countDocuments(filtro)
  ]);
  res.json({ itens: itens.map(execucaoParaJson), pagina, limite, total });
});

/** Dispara a coleta de uma fonte imediatamente (sem esperar o agendamento). */
app.post("/api/v1/execucoes", async (req, res) => {
  exigirAdmin(req);
  const fonteId = new Corpo(req.body).uuid("fonteId");
  const fonte = await fontes.findOne({ _id: fonteId });
  if (!fonte) throw erros.naoEncontrado("Fonte não encontrada");
  const execucao = await executarColeta(fonte);
  res.status(201).location(`/api/v1/execucoes/${execucao._id}`).json(execucaoParaJson(execucao));
});

app.get("/api/v1/candidatos", async (req, res) => {
  exigirAdmin(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const filtro: Filter<DocCandidato> = {};
  const status = textoDaQuery(req.query.status);
  const origem = textoDaQuery(req.query.origem);
  const fonteId = textoDaQuery(req.query.fonteId);
  if (status) {
    if (!(STATUS as readonly string[]).includes(status)) throw erros.requisicaoInvalida("status inválido");
    filtro.status = status as Status;
  }
  if (origem) {
    if (!(ORIGENS as readonly string[]).includes(origem)) throw erros.requisicaoInvalida("origem inválida");
    filtro.origem = origem as Origem;
  }
  if (fonteId) filtro.fonteId = fonteId;
  const [itens, total] = await Promise.all([
    candidatos.find(filtro).sort({ coletadoEm: -1 }).skip(offset).limit(limite).toArray(),
    candidatos.countDocuments(filtro)
  ]);
  res.json({ itens: itens.map(candidatoParaJson), pagina, limite, total });
});

app.get("/api/v1/candidatos/:candidatoId", async (req, res) => {
  exigirAdmin(req);
  const id = idDoCaminho(req.params.candidatoId, "Candidato");
  const candidato = await candidatos.findOne({ _id: id });
  if (!candidato) throw erros.naoEncontrado("Candidato não encontrado");
  res.json(candidatoParaJson(candidato));
});

/** Cadastro manual: quem quer divulgar algo procura um admin, que registra o candidato. */
app.post("/api/v1/candidatos", async (req, res) => {
  exigirAdmin(req);
  const corpo = new Corpo(req.body);
  const titulo = corpo.texto("titulo", 300);
  const data = corpo.dataOpcional("data");
  const descricao = corpo.textoOpcional("descricao", 20000);
  const solicitante = corpo.textoOpcional("solicitante", 200);
  const agora = new Date();
  const candidato: DocCandidato = {
    _id: randomUUID(),
    origem: "MANUAL",
    urlOrigem: corpo.url("urlOrigem"),
    tituloExtraido: titulo,
    ...(descricao ? { descricaoExtraida: descricao } : {}),
    ...(data ? { dataExtraida: data } : {}),
    ...(solicitante ? { solicitante } : {}),
    status: "PENDENTE",
    hash: hashCandidato(titulo, data),
    scoreDuplicidade: await scoreDuplicidade(titulo),
    coletadoEm: agora,
    atualizadoEm: agora
  };
  try {
    await candidatos.insertOne(candidato);
  } catch (erro) {
    if (ehChaveDuplicada(erro)) throw erros.conflito("Já existe um candidato com este título e data");
    throw erro;
  }
  res.status(201).location(`/api/v1/candidatos/${candidato._id}`).json(candidatoParaJson(candidato));
});

/** Curadoria: descartar ou marcar como duplicado (apenas candidatos PENDENTES). */
app.patch("/api/v1/candidatos/:candidatoId", async (req, res) => {
  exigirAdmin(req);
  const id = idDoCaminho(req.params.candidatoId, "Candidato");
  const status = new Corpo(req.body).enumeracao("status", ["DESCARTADO", "DUPLICADO"] as const);
  const atualizado = await candidatos.findOneAndUpdate(
    { _id: id, status: "PENDENTE" },
    { $set: { status, atualizadoEm: new Date() } },
    { returnDocument: "after" }
  );
  if (!atualizado) {
    const existe = await candidatos.findOne({ _id: id });
    if (!existe) throw erros.naoEncontrado("Candidato não encontrado");
    throw erros.conflito(`Candidato está ${existe.status}; só candidatos PENDENTES podem ser alterados`);
  }
  res.json(candidatoParaJson(atualizado));
});

// ---------- API interna (Oportunidades / SAGA) ----------

const interno = express.Router();
interno.use(exigirTokenServico(TOKEN_SERVICO));

/** Usado por Oportunidades para validar o candidato ao cadastrar uma oportunidade. */
interno.get("/candidatos/:candidatoId", async (req, res) => {
  const id = idDoCaminho(req.params.candidatoId, "Candidato");
  const candidato = await candidatos.findOne({ _id: id });
  if (!candidato) throw erros.naoEncontrado("Candidato não encontrado");
  res.json(candidatoParaJson(candidato));
});

/** SAGA, passo 2. Atômico (filtro por status) e idempotente por sagaId. */
interno.post("/candidatos/:candidatoId/consumo", async (req, res) => {
  const id = idDoCaminho(req.params.candidatoId, "Candidato");
  const sagaId = new Corpo(req.body).uuid("sagaId");
  const consumido = await candidatos.findOneAndUpdate(
    { _id: id, $or: [{ status: "PENDENTE" }, { status: "CONSUMIDO", sagaId }] },
    { $set: { status: "CONSUMIDO", sagaId, atualizadoEm: new Date() } },
    { returnDocument: "after" }
  );
  if (!consumido) {
    const existe = await candidatos.findOne({ _id: id });
    if (!existe) throw erros.naoEncontrado("Candidato não encontrado");
    throw erros.conflito(`Candidato indisponível para publicação (status ${existe.status})`);
  }
  log.info("Candidato consumido pela SAGA", { candidatoId: id, sagaId });
  res.json(candidatoParaJson(consumido));
});

/** SAGA, compensação do passo 2. Só desfaz o consumo feito por esta mesma SAGA. */
interno.post("/candidatos/:candidatoId/liberacao", async (req, res) => {
  const id = idDoCaminho(req.params.candidatoId, "Candidato");
  const sagaId = new Corpo(req.body).uuid("sagaId");
  await candidatos.updateOne(
    { _id: id, status: "CONSUMIDO", sagaId },
    { $set: { status: "PENDENTE", atualizadoEm: new Date() }, $unset: { sagaId: "" } }
  );
  const candidato = await candidatos.findOne({ _id: id });
  if (!candidato) throw erros.naoEncontrado("Candidato não encontrado");
  log.info("Candidato liberado pela compensação da SAGA", { candidatoId: id, sagaId });
  res.json(candidatoParaJson(candidato));
});

app.use("/internal", interno);
finalizarApp(app, SERVICO);

// ---------- Inicialização ----------

async function prepararBanco(): Promise<void> {
  await mongo.connect();
  await candidatos.createIndex({ hash: 1 }, { unique: true });
  await candidatos.createIndex({ status: 1, coletadoEm: -1 });
  await fontes.createIndex({ url: 1 }, { unique: true });
  const total = await fontes.countDocuments();
  if (total === 0) {
    const fonte: DocFonte = {
      _id: randomUUID(),
      nome: "Agenda de exemplo (dados fictícios)",
      url: "https://ufla.br/",
      tipo: "EXEMPLO",
      periodicidadeCron: "0 * * * *",
      ativa: true,
      criadaEm: new Date()
    };
    await fontes.insertOne(fonte);
    log.info("Fonte de exemplo criada; executando a primeira coleta");
    await executarColeta(fonte);
  }
}

async function coletarFontesAtivas(): Promise<void> {
  const ativas = await fontes.find({ ativa: true }).toArray();
  for (const fonte of ativas) await executarColeta(fonte);
}

async function iniciarServico(): Promise<void> {
  for (;;) {
    try {
      await prepararBanco();
      break;
    } catch (erro) {
      log.aviso("MongoDB indisponível; nova tentativa em 3 s", { erro: (erro as Error).message });
      await new Promise((resolver) => setTimeout(resolver, 3000));
    }
  }
  setInterval(() => void coletarFontesAtivas().catch(() => undefined), INTERVALO_MINUTOS * 60 * 1000);
}

iniciar(app, PORTA, SERVICO, () => mongo.close());
void iniciarServico();
