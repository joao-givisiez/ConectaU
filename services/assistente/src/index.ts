import { randomUUID } from "node:crypto";
import express from "express";
import {
  Corpo,
  criarApp,
  criarLog,
  criarPool,
  erros,
  exigirTokenServico,
  exigirUsuario,
  finalizarApp,
  idDoCaminho,
  iniciar,
  transacao,
  variavel,
  variavelBooleana,
  variavelNumero,
  verificarBanco
} from "@conectau/comum";
import { EmbeddingsLocais, dividirEmTrechos, paraPgvector, type ProvedorEmbeddings } from "./embeddings.js";

const SERVICO = "assistente";
const PORTA = variavelNumero("PORT", 3105);
const TOKEN_SERVICO = variavel("TOKEN_SERVICO");
/** Liga uma falha controlada da indexação, para demonstrar a compensação da SAGA. */
const SIMULAR_FALHA_INDEXACAO = variavelBooleana("SIMULAR_FALHA_INDEXACAO");
const TRECHOS_POR_RESPOSTA = 4;

const log = criarLog(SERVICO);
const pool = criarPool();
const embeddings: ProvedorEmbeddings = new EmbeddingsLocais();

const app = criarApp(SERVICO, async () => {
  await verificarBanco(pool);
  const { rows } = await pool.query<{ total: string }>("SELECT count(*) AS total FROM chunks");
  return {
    banco: "ok",
    embeddings: embeddings.nome,
    chunksIndexados: Number(rows[0]?.total ?? 0),
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

interface Trecho {
  oportunidade_id: string;
  titulo: string;
  texto: string;
  fonte_url: string | null;
  distancia: number;
}

/**
 * Pergunta ao assistente. Nesta etapa a resposta é apenas de RECUPERAÇÃO (busca vetorial no
 * pgvector): devolve os trechos mais relevantes, com citações, e marca `degradada: true`.
 * A geração da resposta por um LLM (RAG completo, com LangChain) é escopo da Parte 4.
 */
app.post("/api/v1/conversas/:conversaId/mensagens", async (req, res) => {
  const usuario = exigirUsuario(req);
  const conversaId = idDoCaminho(req.params.conversaId, "Conversa");
  const pergunta = new Corpo(req.body).texto("pergunta", 2000);
  const conversa = (
    await pool.query<{ usuario_id: string; oportunidade_id: string | null }>(
      "SELECT usuario_id, oportunidade_id FROM conversas WHERE id = $1",
      [conversaId]
    )
  ).rows[0];
  if (!conversa) throw erros.naoEncontrado("Conversa não encontrada");
  if (conversa.usuario_id !== usuario.id) throw erros.acessoNegado("A conversa pertence a outro usuário");

  const vetor = paraPgvector(await embeddings.gerar(pergunta));
  const { rows: trechos } = await pool.query<Trecho>(
    `SELECT oportunidade_id, titulo, texto, fonte_url, embedding <=> $1::vector AS distancia
       FROM chunks
      WHERE ($2::uuid IS NULL OR oportunidade_id = $2)
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vetor, conversa.oportunidade_id, TRECHOS_POR_RESPOSTA]
  );

  const citacoes = trechos.map((t) => ({
    oportunidadeId: t.oportunidade_id,
    titulo: t.titulo,
    trecho: t.texto,
    fonteUrl: t.fonte_url ?? undefined,
    similaridade: Math.round((1 - Number(t.distancia)) * 100) / 100
  }));
  const resposta =
    trechos.length === 0
      ? "Ainda não há editais indexados que respondam a esta pergunta."
      : "Modo de recuperação (sem modelo de linguagem nesta etapa): estes são os trechos mais relevantes " +
        "encontrados nos editais indexados. Confira os detalhes no canal oficial de cada oportunidade.";

  const id = randomUUID();
  const { rows } = await pool.query<{ criada_em: Date }>(
    `INSERT INTO mensagens (id, conversa_id, pergunta, resposta, citacoes, degradada)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING criada_em`,
    [id, conversaId, pergunta, resposta, JSON.stringify(citacoes)]
  );
  res.status(201).json({
    id,
    conversaId,
    pergunta,
    resposta,
    citacoes,
    degradada: true,
    criadaEm: rows[0]!.criada_em.toISOString()
  });
});

// ---------- API interna (SAGA de publicação) ----------

const interno = express.Router();
interno.use(exigirTokenServico(TOKEN_SERVICO));

/**
 * SAGA, passo 3. Substitui o índice da oportunidade numa única transação:
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
    throw erros.indisponivel("Provedor de embeddings indisponível (falha simulada)");
  }

  const trechos = dividirEmTrechos(texto.startsWith(titulo) ? texto : `${titulo}. ${texto}`);
  const vetores = await Promise.all(trechos.map((t) => embeddings.gerar(t)));
  await transacao(pool, async (cliente) => {
    await cliente.query("DELETE FROM chunks WHERE oportunidade_id = $1", [oportunidadeId]);
    for (const [ordem, trecho] of trechos.entries()) {
      await cliente.query(
        `INSERT INTO chunks (id, oportunidade_id, saga_id, ordem, titulo, texto, fonte_url, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
        [randomUUID(), oportunidadeId, sagaId, ordem, titulo, trecho, fonteUrl ?? null, paraPgvector(vetores[ordem]!)]
      );
    }
  });
  log.info(`Oportunidade indexada em ${trechos.length} trecho(s)`, { oportunidadeId, sagaId });
  res.json({ oportunidadeId, sagaId, chunks: trechos.length });
});

/** SAGA, compensação do passo 3. Idempotente: remover o que não existe também responde 204. */
interno.delete("/indexacoes/:oportunidadeId", async (req, res) => {
  const oportunidadeId = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const { rowCount } = await pool.query("DELETE FROM chunks WHERE oportunidade_id = $1", [oportunidadeId]);
  log.info(`Compensação: ${rowCount ?? 0} trecho(s) removido(s)`, { oportunidadeId });
  res.status(204).end();
});

app.use("/internal", interno);
finalizarApp(app, SERVICO);

iniciar(app, PORTA, SERVICO, () => pool.end());
