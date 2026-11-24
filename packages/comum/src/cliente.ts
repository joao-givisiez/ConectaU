import { esperar } from "./util.js";

/**
 * Falha numa chamada a outro serviço.
 * - `status` definido: o serviço respondeu com erro HTTP.
 * - `status` indefinido: falha de rede ou timeout.
 * - `incerto`: houve timeout, então o comando pode ter sido aplicado sem que a resposta chegasse.
 */
export class ErroChamada extends Error {
  readonly status: number | undefined;
  readonly incerto: boolean;
  readonly corpo: unknown;

  constructor(mensagem: string, status: number | undefined, incerto: boolean, corpo?: unknown) {
    super(mensagem);
    this.name = "ErroChamada";
    this.status = status;
    this.incerto = incerto;
    this.corpo = corpo;
  }

  /** Erro de negócio (4xx): repetir a chamada não muda o resultado. */
  get definitivo(): boolean {
    return this.status !== undefined && this.status < 500;
  }
}

export interface OpcoesChamada {
  metodo?: string;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
  /** Tempo máximo de cada tentativa. */
  timeoutMs?: number;
  /** Número de retentativas após a primeira chamada (0 = sem retentativa). */
  retentativas?: number;
  /** Espera antes da primeira retentativa; dobra a cada nova tentativa (backoff exponencial). */
  esperaInicialMs?: number;
  requestId?: string;
  /** Chamado antes de cada retentativa, para registro. */
  aoRetentar?: (tentativa: number, erro: ErroChamada) => void;
}

export interface Resposta<T> {
  status: number;
  corpo: T;
}

/** Chamada HTTP JSON com timeout, retentativa com backoff exponencial e propagação de X-Request-Id. */
export async function chamar<T = unknown>(url: string, opcoes: OpcoesChamada = {}): Promise<Resposta<T>> {
  const metodo = opcoes.metodo ?? "GET";
  const retentativas = opcoes.retentativas ?? 0;
  let espera = opcoes.esperaInicialMs ?? 1000;
  let ultimoErro: ErroChamada | undefined;

  for (let tentativa = 0; tentativa <= retentativas; tentativa++) {
    if (tentativa > 0 && ultimoErro) {
      opcoes.aoRetentar?.(tentativa, ultimoErro);
      await esperar(espera);
      espera *= 2;
    }
    try {
      return await executar<T>(url, metodo, opcoes);
    } catch (erro) {
      const erroChamada = erro instanceof ErroChamada ? erro : converter(erro, metodo, url);
      if (erroChamada.definitivo) throw erroChamada;
      ultimoErro = erroChamada;
    }
  }
  throw ultimoErro ?? new ErroChamada(`Falha ao chamar ${metodo} ${url}`, undefined, false);
}

async function executar<T>(url: string, metodo: string, opcoes: OpcoesChamada): Promise<Resposta<T>> {
  const cabecalhos: Record<string, string> = { Accept: "application/json", ...opcoes.cabecalhos };
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  if (opcoes.requestId) cabecalhos["X-Request-Id"] = opcoes.requestId;

  const resposta = await fetch(url, {
    method: metodo,
    headers: cabecalhos,
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : null,
    signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5000)
  });
  const texto = await resposta.text();
  const corpo = texto ? interpretar(texto) : undefined;
  if (!resposta.ok) {
    throw new ErroChamada(`${metodo} ${url} respondeu ${resposta.status}`, resposta.status, false, corpo);
  }
  return { status: resposta.status, corpo: corpo as T };
}

function interpretar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

function converter(erro: unknown, metodo: string, url: string): ErroChamada {
  const nome = erro instanceof Error ? erro.name : "";
  if (nome === "TimeoutError" || nome === "AbortError") {
    return new ErroChamada(`Tempo esgotado em ${metodo} ${url}`, undefined, true);
  }
  const motivo = erro instanceof Error ? (erro.cause instanceof Error ? erro.cause.message : erro.message) : String(erro);
  return new ErroChamada(`Falha de rede em ${metodo} ${url}: ${motivo}`, undefined, false);
}
