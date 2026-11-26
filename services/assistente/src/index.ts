import { randomUUID } from "node:crypto";
import express from "express";
import {
  Consumidor,
  Corpo,
  criarApp,
  criarLog,
  criarPool,
  erros,
  esperar,
  exigirTokenServico,
  exigirUsuario,
  finalizarApp,
  idDoCaminho,
  iniciar,
  requestIdDe,
  variavel,
  variavelBooleana,
  variavelNumero,
  verificarBanco
} from "@conectau/comum";
import { ingerirConhecimento } from "./conhecimento.js";
import { EmbeddingsMultilingues } from "./embeddings.js";
import { criarTratadorDeEventos, indexarOportunidade, removerOportunidade } from "./indexacao.js";
import { ProvedorLlm } from "./llm.js";
import { calcularMetricas } from "./metricas.js";
import { criarRespondedor } from "./perguntar.js";
import { MODOS } from "./tipos.js";

/**
 * Assistente: RAG sobre a base de conhecimento do ConectaU e sobre os editais das oportunidades
 * publicadas, com agente LangChain, LLM da Groq tratado como dependência falível (disjuntor,
 * retentativa com backoff, cache e fallback) e medição de latência e custo.
 */
const SERVICO = "assistente";
const PORTA = variavelNumero("PORT", 3105);
const TOKEN_SERVICO = variavel("TOKEN_SERVICO");
const OPORTUNIDADES_URL = variavel("OPORTUNIDADES_URL", "http://oportunidades:3103");
const PASTA_CONHECIMENTO = process.env.CONHECIMENTO_DIR || "conhecimento";
/** Liga uma falha controlada da indexação, para demonstrar a compensação da SAGA. */
const SIMULAR_FALHA_INDEXACAO = variavelBooleana("SIMULAR_FALHA_INDEXACAO");

const log = criarLog(SERVICO);
const pool = criarPool();
const embeddings = new EmbeddingsMultilingues({
  modelo: process.env.EMBEDDINGS_MODELO || "Xenova/multilingual-e5-small",
  pastaModelos: process.env.MODELOS_DIR || undefined
});
const llm = new ProvedorLlm((mensagem, contexto) => log.aviso(mensagem, contexto));
const responder = criarRespondedor({ pool, embeddings, llm, oportunidadesUrl: OPORTUNIDADES_URL, log });

const estado = { pronto: false, conhecimento: { documentos: 0, trechos: 0 } };

// Eventos da outbox de Oportunidades: mantêm o índice dos editais em dia depois da publicação.
const consumidor = new Consumidor({
  url: variavel("RABBITMQ_URL"),
  servico: SERVICO,
  fila: "assistente.oportunidades",
  chaves: ["oportunidade.editada", "oportunidade.encerrada"]
});

const app = criarApp(SERVICO, async () => {
  await verificarBanco(pool);
  // Pronto significa: modelo de embeddings carregado e base de conhecimento ingerida.
  if (!estado.pronto) throw new Error("Inicializando: carregando o modelo de embeddings e a base de conhecimento");
  const { rows } = await pool.query<{ total: string }>("SELECT count(*) AS total FROM chunks");
  const situacao = llm.estado();
  return {
    banco: "ok",
    embeddings: { modelo: embeddings.nome, dimensoes: embeddings.dimensoes },
    baseDeConhecimento: estado.conhecimento,
    editaisIndexados: Number(rows[0]?.total ?? 0),
    rabbitmq: consumidor.conectado ? "conectado" : "desconectado",
    llm: { configurado: situacao.configurado, modelo: situacao.modelo, disjuntor: situacao.disjuntor.estado },
    simularFalhaIndexacao: SIMULAR_FALHA_INDEXACAO
  };
});

// ---------- API pública (via BFF Web) ----------

app.post("/api/v1/conversas", async (req, res) => {
  const usuario = exigirUsuario(req);
  const corpo = new Corpo(req.body ?? {});
  const oportunidadeId = corpo.tem("oportunidadeId") ? corpo.uuid("oportunidadeId") : undefined;
  const id = randomUUID();
  const { rows } = await pool.query<{ criada_em: Date }>(
    "INSERT INTO conversas (id, usuario_id, oportunidade_id) VALUES ($1, $2, $3) RETURNING criada_em",
    [id, usuario.id, oportunidadeId ?? null]
  );
  res
    .status(201)
    .location(`/api/v1/conversas/${id}`)
    .json({ id, usuarioId: usuario.id, oportunidadeId, criadaEm: rows[0]!.criada_em.toISOString() });
});

/**
 * Pergunta ao assistente. Por padrão (modo "agente"), um agente LangChain decide se consulta a base de
 * conhecimento, o catálogo de oportunidades ou nenhum dos dois, e o LLM redige a resposta com citações.
 * Se o LLM estiver indisponível, a resposta sai em modo degradado (só os trechos recuperados).
 *
 * `modo` (opcional) existe para a avaliação do RAG: "rag" (cadeia com recuperação), "sem-recuperacao"
 * (linha de base) e "recuperacao" (só a busca vetorial, sem LLM). `semCache: true` ignora o cache.
 */
app.post("/api/v1/conversas/:conversaId/mensagens", async (req, res) => {
  const usuario = exigirUsuario(req);
  const conversaId = idDoCaminho(req.params.conversaId, "Conversa");
  const corpo = new Corpo(req.body);
  const pergunta = corpo.texto("pergunta", 2000);
  const modo = corpo.enumeracaoOpcional("modo", MODOS) ?? "agente";
  const semCache = corpo.tem("semCache") ? corpo.booleano("semCache") : false;

  const conversa = (
    await pool.query<{ usuario_id: string; oportunidade_id: string | null }>(
      "SELECT usuario_id, oportunidade_id FROM conversas WHERE id = $1",
      [conversaId]
    )
  ).rows[0];
  if (!conversa) throw erros.naoEncontrado("Conversa não encontrada");
  if (conversa.usuario_id !== usuario.id) throw erros.acessoNegado("A conversa pertence a outro usuário");
  if (!estado.pronto) throw erros.indisponivel("O assistente está inicializando; tente de novo em instantes");

  const resposta = await responder({
    conversaId,
    pergunta,
    modo,
    semCache,
    oportunidadeId: conversa.oportunidade_id ?? undefined,
    requestId: requestIdDe(res)
  });
  res.status(201).json(resposta);
});

// ---------- API interna (SAGA de publicação, operação e medição) ----------

const interno = express.Router();
interno.use(exigirTokenServico(TOKEN_SERVICO));

/**
 * SAGA, passo 2. Substitui o índice da oportunidade numa única transação:
 * ou grava todos os trechos, ou nenhum. Por ser substituição, é idempotente (PUT).
 */
interno.put("/indexacoes/:oportunidadeId", async (req, res) => {
  const oportunidadeId = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const corpo = new Corpo(req.body);
  const sagaId = corpo.uuid("sagaId");
  const titulo = corpo.texto("titulo", 300);
  const texto = corpo.texto("texto", 100000);
  const fonteUrl = corpo.urlOpcional("fonteUrl");

  if (SIMULAR_FALHA_INDEXACAO) {
    log.aviso("Falha de indexação simulada (SIMULAR_FALHA_INDEXACAO=true)", { oportunidadeId, sagaId });
    throw erros.indisponivel("Indexação indisponível (falha simulada)");
  }

  const chunks = await indexarOportunidade(pool, embeddings, { oportunidadeId, sagaId, titulo, texto, fonteUrl });
  log.info(`Oportunidade indexada em ${chunks} trecho(s)`, { oportunidadeId, sagaId });
  res.json({ oportunidadeId, sagaId, chunks });
});

/** SAGA, compensação do passo 2. Idempotente: remover o que não existe também responde 204. */
interno.delete("/indexacoes/:oportunidadeId", async (req, res) => {
  const oportunidadeId = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const removidos = await removerOportunidade(pool, oportunidadeId);
  log.info(`Compensação: ${removidos} trecho(s) removido(s)`, { oportunidadeId });
  res.status(204).end();
});

/** Estado do LLM (disjuntor, configuração) e métricas de latência, tokens e custo. */
interno.get("/llm", async (req, res) => {
  const horas = Math.min(24 * 30, Math.max(1, Number(req.query.horas ?? 24) || 24));
  res.json({ ...llm.estado(), metricas: await calcularMetricas(pool, horas) });
});

/** Injeta falha ou lentidão no provedor, para demonstrar o disjuntor e o fallback ao vivo. */
interno.put("/llm/simulacao", (req, res) => {
  const corpo = new Corpo(req.body);
  if (corpo.tem("falha")) llm.politica.simulacao.falha = corpo.booleano("falha");
  if (corpo.tem("latenciaMs")) llm.politica.simulacao.latenciaMs = corpo.inteiroOpcional("latenciaMs", 0, 120_000) ?? 0;
  log.aviso("Simulação de falha do LLM alterada", { ...llm.politica.simulacao });
  res.json(llm.estado());
});

/** Reingere a base de conhecimento (só reprocessa os documentos que mudaram). */
interno.post("/conhecimento/reindexar", async (_req, res) => {
  const resumo = await ingerirConhecimento(pool, embeddings, PASTA_CONHECIMENTO);
  estado.conhecimento = { documentos: resumo.documentos, trechos: resumo.trechos };
  res.json(resumo);
});

app.use("/internal", interno);
finalizarApp(app, SERVICO);

/** Carrega o modelo de embeddings e ingere a base de conhecimento; tenta de novo até conseguir. */
async function inicializar(): Promise<void> {
  for (;;) {
    try {
      await verificarBanco(pool);
      await embeddings.carregar();
      const resumo = await ingerirConhecimento(pool, embeddings, PASTA_CONHECIMENTO);
      estado.conhecimento = { documentos: resumo.documentos, trechos: resumo.trechos };
      estado.pronto = true;
      consumidor.iniciar(criarTratadorDeEventos(pool, embeddings, log));
      log.info("Assistente pronto", {
        embeddings: embeddings.nome,
        documentos: resumo.documentos,
        trechos: resumo.trechos,
        atualizados: resumo.atualizados,
        llm: llm.estado().configurado ? llm.config.modelo : "não configurado (modo de recuperação)"
      });
      return;
    } catch (erro) {
      log.aviso("Inicialização pendente; nova tentativa em 5 s", { erro: (erro as Error).message });
      await esperar(5000);
    }
  }
}

iniciar(app, PORTA, SERVICO, async () => {
  await consumidor.fechar();
  await pool.end();
});
void inicializar();
