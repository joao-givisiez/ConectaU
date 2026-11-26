import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import type { ChatGeneration, ChatResult, LLMResult } from "@langchain/core/outputs";
import { ChatGroq } from "@langchain/groq";
import { variavelNumero } from "@conectau/comum";
import {
  Disjuntor,
  comRetentativas,
  ehFalhaDoProvedor,
  type ConfigDisjuntor,
  type ResumoDisjuntor
} from "./resiliencia.js";

/**
 * Integração com o LLM (Groq), tratado como uma dependência remota falível.
 * Tudo é configurável por variável de ambiente; a única que precisa ser preenchida é GROQ_API_KEY.
 */
export interface ConfigLlm {
  /** Sem chave, o Assistente funciona em modo de recuperação (sem texto gerado). */
  chave: string | undefined;
  modelo: string;
  /** Endereço alternativo da API (ex.: o simulador local de testes). */
  baseUrl: string | undefined;
  esforcoRaciocinio: "low" | "medium" | "high" | undefined;
  timeoutMs: number;
  retentativas: number;
  esperaInicialMs: number;
  /** Teto para toda a pergunta, somando as chamadas ao modelo e às ferramentas. */
  prazoTotalMs: number;
  maxTokensSaida: number;
  disjuntor: ConfigDisjuntor;
  /** Preço por milhão de tokens, em dólares, para estimar o custo de cada resposta. */
  precoEntradaUsdMilhao: number;
  precoSaidaUsdMilhao: number;
  cache: { ttlMinutos: number; similaridadeMinima: number };
  /** Guarda de escopo: similaridade mínima com a base, sem e com termo do domínio. */
  escopo: { semTermo: number; comTermo: number };
}

function texto(nome: string): string | undefined {
  const valor = process.env[nome]?.trim();
  return valor ? valor : undefined;
}

export function lerConfigLlm(): ConfigLlm {
  const modelo = texto("GROQ_MODELO") ?? "openai/gpt-oss-120b";
  const bruto = texto("GROQ_REASONING_EFFORT") ?? (modelo.includes("gpt-oss") ? "low" : undefined);
  return {
    chave: texto("GROQ_API_KEY"),
    modelo,
    baseUrl: texto("GROQ_BASE_URL"),
    esforcoRaciocinio: bruto === "low" || bruto === "medium" || bruto === "high" ? bruto : undefined,
    timeoutMs: variavelNumero("LLM_TIMEOUT_MS", 20_000),
    retentativas: variavelNumero("LLM_RETENTATIVAS", 2),
    esperaInicialMs: variavelNumero("LLM_ESPERA_INICIAL_MS", 500),
    prazoTotalMs: variavelNumero("LLM_PRAZO_TOTAL_MS", 40_000),
    maxTokensSaida: variavelNumero("LLM_MAX_TOKENS_SAIDA", 1200),
    disjuntor: {
      limiteFalhas: variavelNumero("LLM_DISJUNTOR_FALHAS", 3),
      janelaMs: variavelNumero("LLM_DISJUNTOR_JANELA_MS", 60_000),
      abertoMs: variavelNumero("LLM_DISJUNTOR_ABERTO_MS", 30_000)
    },
    // Referência: tabela de preços do modelo na documentação da Groq (conferir antes de apresentar).
    precoEntradaUsdMilhao: variavelNumero("GROQ_PRECO_ENTRADA_USD_MILHAO", 0.15),
    precoSaidaUsdMilhao: variavelNumero("GROQ_PRECO_SAIDA_USD_MILHAO", 0.6),
    cache: {
      ttlMinutos: variavelNumero("LLM_CACHE_TTL_MIN", 60),
      similaridadeMinima: variavelNumero("LLM_CACHE_SIMILARIDADE", 0.95)
    },
    // Calibrados com 32 perguntas (17 dentro e 15 fora do escopo) no modelo e5: as perguntas legítimas
    // ficaram entre 0,836 e 0,921; as de fora, entre 0,772 e 0,831 (exceto "bolsa de valores", 0,861,
    // que passa e é recusada pela instrução do agente). Ver docs/parte-4/rag-e-agente.md.
    escopo: {
      semTermo: variavelNumero("ESCOPO_SIMILARIDADE_SEM_TERMO", 0.835),
      comTermo: variavelNumero("ESCOPO_SIMILARIDADE_COM_TERMO", 0.83)
    }
  };
}

export function custoEstimadoUsd(config: ConfigLlm, tokensEntrada: number, tokensSaida: number): number {
  const custo =
    (tokensEntrada / 1e6) * config.precoEntradaUsdMilhao + (tokensSaida / 1e6) * config.precoSaidaUsdMilhao;
  return Math.round(custo * 1e8) / 1e8;
}

/** Falha injetada para demonstrar o disjuntor e o fallback sem depender do provedor real. */
export class ErroProvedorSimulado extends Error {
  readonly status = 503;
  constructor(mensagem = "Falha simulada do provedor de LLM") {
    super(mensagem);
    this.name = "ErroProvedorSimulado";
  }
}

class ErroTempoSimulado extends Error {
  constructor() {
    super("Request timed out. (lentidão simulada)");
    this.name = "APIConnectionTimeoutError";
  }
}

export interface SimulacaoDeFalha {
  /** Toda chamada ao provedor falha com 503. */
  falha: boolean;
  /** Atraso artificial antes de cada chamada; se passar do timeout, a chamada estoura. */
  latenciaMs: number;
}

/** Política aplicada a TODA chamada ao modelo: disjuntor + retentativa com backoff + timeout. */
export class PoliticaResiliencia {
  readonly disjuntor: Disjuntor;
  readonly simulacao: SimulacaoDeFalha = { falha: false, latenciaMs: 0 };

  constructor(
    private readonly config: ConfigLlm,
    private readonly aoAvisar: (mensagem: string, contexto?: Record<string, unknown>) => void
  ) {
    this.disjuntor = new Disjuntor(config.disjuntor, Date.now, (de, para) =>
      aoAvisar(`Disjuntor do LLM: ${de} → ${para}`, { de, para })
    );
  }

  executar<T>(sinal: AbortSignal | undefined, chamada: () => Promise<T>): Promise<T> {
    return this.disjuntor.executar(
      () =>
        comRetentativas(
          async () => {
            await this.aplicarSimulacao();
            return chamada();
          },
          {
            retentativas: this.config.retentativas,
            esperaInicialMs: this.config.esperaInicialMs,
            esperaMaximaMs: 8000,
            sinal,
            aoRetentar: (tentativa, erro, esperaMs) =>
              this.aoAvisar(`Chamada ao LLM falhou; retentativa ${tentativa} em ${esperaMs} ms`, {
                erro: erro instanceof Error ? erro.message : String(erro)
              })
          }
        ),
      ehFalhaDoProvedor
    );
  }

  private async aplicarSimulacao(): Promise<void> {
    const { falha, latenciaMs } = this.simulacao;
    if (latenciaMs > 0) {
      const espera = Math.min(latenciaMs, this.config.timeoutMs);
      await new Promise((resolver) => setTimeout(resolver, espera));
      if (latenciaMs >= this.config.timeoutMs) throw new ErroTempoSimulado();
    }
    if (falha) throw new ErroProvedorSimulado();
  }
}

/**
 * ChatGroq com a política de resiliência: sobrescrever `_generate` garante que o agente, as cadeias
 * e qualquer outro uso do modelo passem pelo disjuntor, pelo timeout e pelas retentativas.
 */
class ChatGroqResiliente extends ChatGroq {
  constructor(
    campos: ConstructorParameters<typeof ChatGroq>[0],
    private readonly politica: PoliticaResiliencia
  ) {
    super(campos);
  }

  override async _generate(
    mensagens: BaseMessage[],
    opcoes: this["ParsedCallOptions"],
    gerenciador?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    return this.politica.executar(opcoes.signal, () => super._generate(mensagens, opcoes, gerenciador));
  }
}

/** Soma os tokens de todas as chamadas ao modelo feitas durante uma pergunta (agente = várias). */
export class ContadorDeUso extends BaseCallbackHandler {
  name = "contador_de_uso";
  entrada = 0;
  saida = 0;
  chamadas = 0;

  override handleLLMEnd(resultado: LLMResult): void {
    this.chamadas++;
    let somouPorMensagem = false;
    for (const geracoes of resultado.generations) {
      for (const geracao of geracoes) {
        const uso = ((geracao as ChatGeneration).message as { usage_metadata?: UsageMetadata } | undefined)?.usage_metadata;
        if (!uso) continue;
        this.entrada += uso.input_tokens;
        this.saida += uso.output_tokens;
        somouPorMensagem = true;
      }
    }
    if (!somouPorMensagem) {
      const uso = (resultado.llmOutput as { tokenUsage?: { promptTokens?: number; completionTokens?: number } } | undefined)
        ?.tokenUsage;
      this.entrada += uso?.promptTokens ?? 0;
      this.saida += uso?.completionTokens ?? 0;
    }
  }
}

export class ProvedorLlm {
  readonly config: ConfigLlm;
  readonly politica: PoliticaResiliencia;
  readonly modelo: ChatGroq;

  constructor(aoAvisar: (mensagem: string, contexto?: Record<string, unknown>) => void) {
    this.config = lerConfigLlm();
    this.politica = new PoliticaResiliencia(this.config, aoAvisar);
    this.modelo = new ChatGroqResiliente(
      {
        // Sem chave o cliente não é criado; este valor nunca é enviado, pois sem chave não há chamada.
        apiKey: this.config.chave ?? "sem-chave-configurada",
        model: this.config.modelo,
        temperature: 0.2,
        maxTokens: this.config.maxTokensSaida,
        timeout: this.config.timeoutMs,
        // As retentativas são nossas (com backoff e disjuntor); as do LangChain ficam desligadas.
        maxRetries: 0,
        ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
        ...(this.config.esforcoRaciocinio ? { reasoningEffort: this.config.esforcoRaciocinio } : {})
      },
      this.politica
    );
  }

  get chaveConfigurada(): boolean {
    return this.config.chave !== undefined;
  }

  /** Há motivo para tentar o provedor: chave configurada ou falha simulada em andamento. */
  get tentavel(): boolean {
    return this.chaveConfigurada || this.politica.simulacao.falha;
  }

  estado(): {
    configurado: boolean;
    modelo: string;
    baseUrlPersonalizada: boolean;
    disjuntor: ResumoDisjuntor;
    simulacao: SimulacaoDeFalha;
  } {
    return {
      configurado: this.chaveConfigurada,
      modelo: this.config.modelo,
      baseUrlPersonalizada: this.config.baseUrl !== undefined,
      disjuntor: this.politica.disjuntor.resumo(),
      simulacao: { ...this.politica.simulacao }
    };
  }
}

/** Remove blocos de raciocínio (<think>...</think>) que alguns modelos incluem no texto. */
export function limparResposta(textoBruto: string): string {
  return textoBruto.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
