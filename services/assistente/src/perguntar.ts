import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { erros, type Log, type Pool } from "@conectau/comum";
import { buscarNoCache, gravarNoCache, lerVersaoDoIndice } from "./cache.js";
import {
  LIMITE_DE_PASSOS_DO_AGENTE,
  criarAgente,
  criarCadeiaRag,
  criarCadeiaSemRecuperacao,
  dataDeHoje,
  instrucoesDoAgente,
  marcarCitacoes,
  textoDaMensagem
} from "./cadeias.js";
import type { ProvedorEmbeddings } from "./embeddings.js";
import { RESPOSTA_FORA_DO_ESCOPO, avaliarEscopo, type AvaliacaoDeEscopo } from "./escopo.js";
import { chaveDoTrecho, criarRegistroDeFontes, fonteDoTrecho } from "./ferramentas.js";
import { ContadorDeUso, custoEstimadoUsd, limparResposta, type ProvedorLlm } from "./llm.js";
import { recuperar } from "./recuperacao.js";
import { classificarMotivo } from "./resiliencia.js";
import type {
  ContextoPergunta,
  FonteConsultada,
  ModoExecucao,
  MotivoDegradacao,
  OrigemResposta
} from "./tipos.js";

export interface EntradaPergunta {
  conversaId: string;
  pergunta: string;
  modo: ModoExecucao;
  /** Ignora o cache (usado nas medições de latência e custo). */
  semCache: boolean;
  oportunidadeId?: string | undefined;
  requestId?: string | undefined;
}

export interface RespostaGerada {
  id: string;
  conversaId: string;
  pergunta: string;
  resposta: string;
  fontes: FonteConsultada[];
  degradada: boolean;
  motivoDegradacao?: MotivoDegradacao;
  origem: OrigemResposta;
  modo: ModoExecucao;
  modelo?: string;
  latenciaMs: number;
  tokens: { entrada: number; saida: number };
  custoEstimadoUsd: number;
  ferramentas: { nome: string; duracaoMs: number; erro?: string }[];
  cache?: { tipo: "exato" | "semantico"; similaridade: number };
  /** Decisão da guarda de escopo (feita antes de qualquer chamada ao LLM). */
  escopo: AvaliacaoDeEscopo;
  criadaEm: string;
}

export interface DependenciasRespondedor {
  pool: Pool;
  embeddings: ProvedorEmbeddings;
  llm: ProvedorLlm;
  oportunidadesUrl: string;
  log: Log;
}

const EXPLICACAO: Record<MotivoDegradacao, string> = {
  SEM_CHAVE: "o modelo de linguagem não está configurado neste ambiente",
  CIRCUITO_ABERTO: "o provedor do modelo está instável e foi isolado temporariamente",
  PROVEDOR_INDISPONIVEL: "o provedor do modelo está indisponível",
  TEMPO_ESGOTADO: "o modelo demorou demais para responder",
  LIMITE_DO_PROVEDOR: "o limite de uso do provedor foi atingido",
  CHAVE_INVALIDA: "a chave de acesso ao provedor foi recusada",
  SOLICITADO: "o modo de recuperação foi solicitado",
  ERRO_INESPERADO: "houve um erro inesperado ao gerar a resposta"
};

/** Só vale reaproveitar respostas que não dependem de dados mutáveis do catálogo. */
function cacheavel(ctx: ContextoPergunta): boolean {
  return ctx.chamadas.every((c) => c.nome === "consultar_base_conhecimento" && c.erro === undefined);
}

export function criarRespondedor(deps: DependenciasRespondedor) {
  const { pool, embeddings, llm, log } = deps;

  async function carregarHistorico(conversaId: string): Promise<BaseMessage[]> {
    const { rows } = await pool.query<{ pergunta: string; resposta: string }>(
      `SELECT pergunta, resposta FROM mensagens
        WHERE conversa_id = $1 AND NOT degradada ORDER BY criada_em DESC LIMIT 3`,
      [conversaId]
    );
    return rows.reverse().flatMap((m) => [new HumanMessage(m.pergunta), new AIMessage(m.resposta)]);
  }

  async function tituloDaOportunidade(oportunidadeId: string): Promise<string | undefined> {
    const { rows } = await pool.query<{ titulo: string }>(
      "SELECT titulo FROM chunks WHERE oportunidade_id = $1 LIMIT 1",
      [oportunidadeId]
    );
    return rows[0]?.titulo;
  }

  /** Resposta sem modelo: os trechos mais relevantes da base vetorial, com um aviso do motivo. */
  async function respostaDeRecuperacao(
    entrada: EntradaPergunta,
    ctx: ContextoPergunta,
    motivo: MotivoDegradacao
  ): Promise<string> {
    ctx.fontes.length = 0;
    let trechos;
    try {
      trechos = await recuperar(pool, embeddings, entrada.pergunta, {
        k: 3,
        oportunidadeId: entrada.oportunidadeId
      });
    } catch (erro) {
      log.erro("Recuperação indisponível no fallback", { erro: (erro as Error).message });
      throw erros.indisponivel("O assistente está indisponível: nem a busca nos editais respondeu");
    }
    const rotulos = criarRegistroDeFontes(ctx)(trechos.map(fonteDoTrecho), trechos.map(chaveDoTrecho));
    const abertura =
      motivo === "SOLICITADO"
        ? "Modo de recuperação (sem modelo de linguagem)."
        : `Não consegui gerar uma resposta com o modelo de linguagem agora: ${EXPLICACAO[motivo]}.`;
    if (trechos.length === 0) {
      return `${abertura} Também não encontrei trechos relacionados à sua pergunta na base de conhecimento.`;
    }
    const lista = trechos
      .map((t, i) => `[${rotulos[i]}] ${t.titulo}: ${t.texto.replace(/\s+/g, " ").slice(0, 320)}`)
      .join("\n\n");
    return `${abertura} Estes são os trechos mais relevantes que encontrei:\n\n${lista}\n\nConfira os detalhes no canal oficial de cada oportunidade.`;
  }

  return async function responder(entrada: EntradaPergunta): Promise<RespostaGerada> {
    const inicio = Date.now();
    const ctx: ContextoPergunta = {
      fontes: [],
      chamadas: [],
      ...(entrada.oportunidadeId ? { oportunidadeId: entrada.oportunidadeId } : {}),
      ...(entrada.requestId ? { requestId: entrada.requestId } : {})
    };
    const contador = new ContadorDeUso();
    const escopo = entrada.oportunidadeId ?? "geral";
    const historico = await carregarHistorico(entrada.conversaId);

    let resposta = "";
    let origem: OrigemResposta = "LLM";
    let motivo: MotivoDegradacao | undefined;
    let acertoDeCache: { tipo: "exato" | "semantico"; similaridade: number } | undefined;
    let modeloUsado: string | undefined;

    // Cache só na primeira pergunta da conversa: nas seguintes, a resposta depende do histórico.
    const usaCache = entrada.modo === "agente" && !entrada.semCache && historico.length === 0;
    let versao = 0;
    const vetor = await embeddings.gerarConsulta(entrada.pergunta);

    // Guarda de escopo, antes de tudo. Numa conversa em andamento, uma continuação curta ("e o prazo
    // dela?") é avaliada junto com a pergunta anterior, para não ser recusada por falta de contexto.
    const anterior = historico.filter((m) => m instanceof HumanMessage).at(-1);
    const vetorDoEscopo = anterior
      ? await embeddings.gerarConsulta(`${textoDaMensagem(anterior)} ${entrada.pergunta}`)
      : vetor;
    const escopoDaPergunta = await avaliarEscopo(pool, entrada.pergunta, vetorDoEscopo, llm.config.escopo);

    if (!escopoDaPergunta.dentro) {
      origem = "RECUSA";
      resposta = RESPOSTA_FORA_DO_ESCOPO;
      log.info("Pergunta fora do escopo recusada antes do LLM", { ...escopoDaPergunta, requestId: entrada.requestId });
    } else if (entrada.modo === "recuperacao") {
      motivo = "SOLICITADO";
      origem = "FALLBACK";
      resposta = await respostaDeRecuperacao(entrada, ctx, motivo);
    } else {
      if (usaCache) {
        versao = await lerVersaoDoIndice(pool);
        const acerto = await buscarNoCache(pool, {
          pergunta: entrada.pergunta,
          escopo,
          versao,
          vetor,
          similaridadeMinima: llm.config.cache.similaridadeMinima
        });
        if (acerto) {
          origem = "CACHE";
          resposta = acerto.resposta.resposta;
          ctx.fontes.push(...acerto.resposta.fontes);
          modeloUsado = acerto.resposta.modelo;
          acertoDeCache = { tipo: acerto.tipo, similaridade: Math.round(acerto.similaridade * 1000) / 1000 };
        }
      }

      if (origem !== "CACHE") {
        if (!llm.tentavel) {
          motivo = "SEM_CHAVE";
        } else {
          try {
            resposta = await gerarComModelo(entrada, ctx, historico, contador);
            modeloUsado = llm.config.modelo;
          } catch (erro) {
            motivo = classificarMotivo(erro);
            log.aviso("LLM indisponível; usando o fallback de recuperação", {
              motivo,
              erro: erro instanceof Error ? erro.message : String(erro),
              requestId: entrada.requestId
            });
          }
        }
        if (motivo !== undefined) {
          origem = "FALLBACK";
          ctx.chamadas.length = 0;
          resposta = await respostaDeRecuperacao(entrada, ctx, motivo);
        }
      }
    }

    marcarCitacoes(resposta, ctx.fontes);

    if (usaCache && origem === "LLM" && cacheavel(ctx)) {
      await gravarNoCache(pool, {
        pergunta: entrada.pergunta,
        escopo,
        versao,
        vetor,
        resposta: { resposta, fontes: ctx.fontes, modelo: modeloUsado ?? llm.config.modelo },
        ttlMinutos: llm.config.cache.ttlMinutos
      }).catch((erro: unknown) => log.aviso("Não foi possível gravar no cache", { erro: String(erro) }));
    }

    const latenciaMs = Date.now() - inicio;
    const custo = custoEstimadoUsd(llm.config, contador.entrada, contador.saida);
    const id = randomUUID();
    const { rows } = await pool.query<{ criada_em: Date }>(
      `INSERT INTO mensagens (id, conversa_id, pergunta, resposta, fontes, degradada, motivo_degradacao, modo, origem,
                              modelo, latencia_ms, tokens_entrada, tokens_saida, custo_estimado_usd, ferramentas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING criada_em`,
      [
        id,
        entrada.conversaId,
        entrada.pergunta,
        resposta,
        JSON.stringify(ctx.fontes),
        origem === "FALLBACK",
        motivo ?? null,
        entrada.modo,
        origem,
        modeloUsado ?? null,
        latenciaMs,
        contador.entrada,
        contador.saida,
        custo,
        JSON.stringify(ctx.chamadas)
      ]
    );
    log.info("Pergunta respondida", {
      requestId: entrada.requestId,
      modo: entrada.modo,
      origem,
      motivo,
      latenciaMs,
      tokensEntrada: contador.entrada,
      tokensSaida: contador.saida,
      ferramentas: ctx.chamadas.map((c) => c.nome)
    });

    return {
      id,
      conversaId: entrada.conversaId,
      pergunta: entrada.pergunta,
      resposta,
      fontes: ctx.fontes,
      degradada: origem === "FALLBACK",
      ...(motivo ? { motivoDegradacao: motivo } : {}),
      origem,
      modo: entrada.modo,
      ...(modeloUsado ? { modelo: modeloUsado } : {}),
      latenciaMs,
      tokens: { entrada: contador.entrada, saida: contador.saida },
      custoEstimadoUsd: custo,
      ferramentas: ctx.chamadas,
      ...(acertoDeCache ? { cache: acertoDeCache } : {}),
      escopo: escopoDaPergunta,
      criadaEm: rows[0]!.criada_em.toISOString()
    };
  };

  async function gerarComModelo(
    entrada: EntradaPergunta,
    ctx: ContextoPergunta,
    historico: BaseMessage[],
    contador: ContadorDeUso
  ): Promise<string> {
    const sinal = AbortSignal.timeout(llm.config.prazoTotalMs);
    const configuracao = { callbacks: [contador], signal: sinal };
    const hoje = dataDeHoje();
    const dependencias = { pool, embeddings, oportunidadesUrl: deps.oportunidadesUrl };
    let texto: string;

    if (entrada.modo === "sem-recuperacao") {
      texto = await criarCadeiaSemRecuperacao(llm.modelo).invoke(
        { pergunta: entrada.pergunta, hoje, historico },
        configuracao
      );
    } else if (entrada.modo === "rag") {
      const saida = await criarCadeiaRag(dependencias, llm.modelo, ctx).invoke(
        { pergunta: entrada.pergunta, hoje, historico },
        configuracao
      );
      texto = saida.resposta;
    } else {
      const titulo = entrada.oportunidadeId ? await tituloDaOportunidade(entrada.oportunidadeId) : undefined;
      const instrucoes = instrucoesDoAgente(
        hoje,
        entrada.oportunidadeId ? { oportunidadeId: entrada.oportunidadeId, titulo } : undefined
      );
      const agente = criarAgente(dependencias, llm.modelo, ctx, instrucoes);
      const resultado = await agente.invoke(
        { messages: [...historico, new HumanMessage(entrada.pergunta)] },
        { ...configuracao, recursionLimit: LIMITE_DE_PASSOS_DO_AGENTE }
      );
      texto = textoDaMensagem(resultado.messages.at(-1));
    }

    const limpo = limparResposta(texto);
    if (limpo === "") throw new Error("O modelo devolveu uma resposta vazia");
    return limpo;
  }
}
