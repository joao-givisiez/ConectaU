import type { MotivoDegradacao } from "./tipos.js";

/**
 * Mecanismos para tratar o LLM como uma dependência remota falível:
 *  - Disjuntor (circuit breaker): depois de falhas repetidas, para de chamar o provedor por um
 *    tempo e responde na hora pelo fallback, em vez de acumular chamadas que vão falhar;
 *  - Retentativa com backoff exponencial e jitter, respeitando o Retry-After do provedor;
 *  - Classificação das falhas: só erro do provedor (rede, timeout, 429, 5xx) conta para o disjuntor;
 *    erro de configuração ou de requisição (401, 400...) não adianta repetir nem abre o circuito.
 */

// ---------------------------------------------------------------- disjuntor

export type EstadoDisjuntor = "FECHADO" | "ABERTO" | "MEIO_ABERTO";

export interface ConfigDisjuntor {
  /** Falhas dentro da janela que abrem o circuito. */
  limiteFalhas: number;
  janelaMs: number;
  /** Quanto tempo o circuito fica aberto antes de permitir uma chamada de teste. */
  abertoMs: number;
}

export class ErroDisjuntorAberto extends Error {
  constructor(readonly retomadaEmMs: number) {
    super(`Circuito aberto: o provedor de LLM está sendo poupado por mais ${Math.ceil(retomadaEmMs / 1000)} s`);
    this.name = "ErroDisjuntorAberto";
  }
}

export interface ResumoDisjuntor {
  estado: EstadoDisjuntor;
  falhasNaJanela: number;
  retomadaEmMs: number;
  sucessos: number;
  falhas: number;
  rejeitadas: number;
  aberturas: number;
}

/**
 * FECHADO: as chamadas passam. Ao atingir `limiteFalhas` dentro de `janelaMs`, vai para ABERTO.
 * ABERTO: recusa todas as chamadas, sem tocar no provedor, durante `abertoMs`.
 * MEIO_ABERTO: deixa passar uma única chamada de teste; se der certo, volta a FECHADO; se falhar,
 * volta a ABERTO por mais `abertoMs`.
 */
export class Disjuntor {
  private falhasRecentes: number[] = [];
  private aberto = false;
  private abertoAte = 0;
  private sondando = false;
  private contadores = { sucessos: 0, falhas: 0, rejeitadas: 0, aberturas: 0 };

  constructor(
    private readonly config: ConfigDisjuntor,
    private readonly agora: () => number = Date.now,
    private readonly aoMudar?: (de: EstadoDisjuntor, para: EstadoDisjuntor) => void
  ) {}

  get estado(): EstadoDisjuntor {
    if (!this.aberto) return "FECHADO";
    return this.agora() >= this.abertoAte ? "MEIO_ABERTO" : "ABERTO";
  }

  resumo(): ResumoDisjuntor {
    this.podarJanela();
    return {
      estado: this.estado,
      falhasNaJanela: this.falhasRecentes.length,
      retomadaEmMs: this.aberto ? Math.max(0, this.abertoAte - this.agora()) : 0,
      ...this.contadores
    };
  }

  /** `contaComoFalha` decide quais erros representam um provedor doente. */
  async executar<T>(chamada: () => Promise<T>, contaComoFalha: (erro: unknown) => boolean = () => true): Promise<T> {
    const antes = this.estado;
    if (antes === "ABERTO" || (antes === "MEIO_ABERTO" && this.sondando)) {
      this.contadores.rejeitadas++;
      throw new ErroDisjuntorAberto(Math.max(0, this.abertoAte - this.agora()));
    }
    const sonda = antes === "MEIO_ABERTO";
    if (sonda) {
      this.sondando = true;
      this.aoMudar?.("ABERTO", "MEIO_ABERTO");
    }
    try {
      const resultado = await chamada();
      this.contadores.sucessos++;
      if (sonda) this.fechar();
      return resultado;
    } catch (erro) {
      if (contaComoFalha(erro)) {
        this.contadores.falhas++;
        this.registrarFalha(sonda);
      } else if (sonda) {
        // O provedor respondeu (com um erro nosso, como 401): está de pé, então o circuito fecha.
        this.fechar();
      }
      throw erro;
    }
  }

  private registrarFalha(sonda: boolean): void {
    this.falhasRecentes.push(this.agora());
    this.podarJanela();
    if (sonda || this.falhasRecentes.length >= this.config.limiteFalhas) this.abrir();
  }

  private podarJanela(): void {
    const corte = this.agora() - this.config.janelaMs;
    this.falhasRecentes = this.falhasRecentes.filter((momento) => momento >= corte);
  }

  private abrir(): void {
    const de = this.sondando ? "MEIO_ABERTO" : "FECHADO";
    this.aberto = true;
    this.sondando = false;
    this.abertoAte = this.agora() + this.config.abertoMs;
    this.contadores.aberturas++;
    this.aoMudar?.(de, "ABERTO");
  }

  private fechar(): void {
    const de = this.estado;
    this.aberto = false;
    this.sondando = false;
    this.falhasRecentes = [];
    if (de !== "FECHADO") this.aoMudar?.(de, "FECHADO");
  }
}

// ---------------------------------------------------------------- classificação de falhas

/** Status HTTP do erro, quando o provedor chegou a responder. */
export function statusDoErro(erro: unknown): number | undefined {
  const status = (erro as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function nomeDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.name : "";
}

/** Falha do lado do provedor ou da rede: vale repetir e conta para o disjuntor. */
export function ehFalhaDoProvedor(erro: unknown): boolean {
  if (erro instanceof ErroDisjuntorAberto) return false;
  const status = statusDoErro(erro);
  if (status === undefined) return true; // sem resposta: rede ou timeout
  return status >= 500 || status === 429 || status === 408;
}

export function classificarMotivo(erro: unknown): MotivoDegradacao {
  if (erro instanceof ErroDisjuntorAberto) return "CIRCUITO_ABERTO";
  const status = statusDoErro(erro);
  if (status === 401 || status === 403) return "CHAVE_INVALIDA";
  if (status === 429) return "LIMITE_DO_PROVEDOR";
  const nome = nomeDoErro(erro);
  const mensagem = erro instanceof Error ? erro.message : "";
  if (/timeout|abort/i.test(nome) || /timed out|tempo esgotado|aborted/i.test(mensagem)) return "TEMPO_ESGOTADO";
  if (status === undefined || status >= 500 || status === 408) return "PROVEDOR_INDISPONIVEL";
  return "ERRO_INESPERADO";
}

// ---------------------------------------------------------------- retentativa

export interface OpcoesRetentativa {
  /** Tentativas extras depois da primeira (0 = não repete). */
  retentativas: number;
  esperaInicialMs: number;
  esperaMaximaMs: number;
  sinal?: AbortSignal | undefined;
  aoRetentar?: (tentativa: number, erro: unknown, esperaMs: number) => void;
}

function esperarAbortavel(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    if (sinal?.aborted) return rejeitar(sinal.reason ?? new Error("Aborted"));
    const temporizador = setTimeout(resolver, ms);
    sinal?.addEventListener(
      "abort",
      () => {
        clearTimeout(temporizador);
        rejeitar(sinal.reason ?? new Error("Aborted"));
      },
      { once: true }
    );
  });
}

/** Segundos pedidos pelo provedor em Retry-After (cabeçalho do erro), se houver. */
function retryAfterMs(erro: unknown): number | undefined {
  const cabecalhos = (erro as { headers?: unknown } | null)?.headers as
    | { get?: (nome: string) => string | null; [chave: string]: unknown }
    | undefined;
  const bruto = cabecalhos?.get ? cabecalhos.get("retry-after") : cabecalhos?.["retry-after"];
  const segundos = Number(bruto);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : undefined;
}

/**
 * Repete a chamada com backoff exponencial (esperaInicial, 2x, 4x...) e jitter: a espera real fica
 * entre metade e o total do valor calculado, para que várias réplicas não retentem juntas.
 */
export async function comRetentativas<T>(
  chamada: () => Promise<T>,
  opcoes: OpcoesRetentativa,
  deveRetentar: (erro: unknown) => boolean = ehFalhaDoProvedor
): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamada();
    } catch (erro) {
      if (tentativa >= opcoes.retentativas || !deveRetentar(erro) || opcoes.sinal?.aborted) throw erro;
      const exponencial = Math.min(opcoes.esperaMaximaMs, opcoes.esperaInicialMs * 2 ** tentativa);
      const comJitter = exponencial / 2 + Math.random() * (exponencial / 2);
      const esperaMs = Math.min(opcoes.esperaMaximaMs, Math.max(comJitter, retryAfterMs(erro) ?? 0));
      opcoes.aoRetentar?.(tentativa + 1, erro, Math.round(esperaMs));
      await esperarAbortavel(esperaMs, opcoes.sinal);
    }
  }
}
