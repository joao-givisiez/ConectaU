import { erros } from "./erros.js";

/** Lê uma variável de ambiente obrigatória (ou usa o padrão informado). */
export function variavel(nome: string, padrao?: string): string {
  const valor = process.env[nome] ?? padrao;
  if (valor === undefined || valor === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }
  return valor;
}

export function variavelNumero(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  const numero = Number(bruto);
  if (!Number.isFinite(numero)) throw new Error(`Variável ${nome} deveria ser numérica: ${bruto}`);
  return numero;
}

export function variavelBooleana(nome: string, padrao = false): boolean {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  return ["1", "true", "sim", "yes"].includes(bruto.toLowerCase());
}

export const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Identificador vindo do caminho: um id malformado é tratado como recurso inexistente (404). */
export function idDoCaminho(valor: unknown, recurso: string): string {
  if (!ehUuid(valor)) throw erros.naoEncontrado(`${recurso} não encontrado(a)`);
  return valor.toLowerCase();
}

export interface Paginacao {
  pagina: number;
  limite: number;
  offset: number;
}

export function paginacao(query: Record<string, unknown>, limitePadrao = 20): Paginacao {
  const pagina = inteiroDaQuery(query.pagina, "pagina", 1);
  const limite = inteiroDaQuery(query.limite, "limite", limitePadrao);
  if (pagina < 1) throw erros.requisicaoInvalida("pagina deve ser maior ou igual a 1");
  if (limite < 1 || limite > 100) throw erros.requisicaoInvalida("limite deve estar entre 1 e 100");
  return { pagina, limite, offset: (pagina - 1) * limite };
}

function inteiroDaQuery(valor: unknown, campo: string, padrao: number): number {
  if (valor === undefined || valor === "") return padrao;
  const numero = Number(valor);
  if (!Number.isInteger(numero)) throw erros.requisicaoInvalida(`${campo} deve ser um número inteiro`);
  return numero;
}

/** Leitura validada de campos de um corpo JSON. */
export class Corpo {
  private readonly dados: Record<string, unknown>;

  constructor(corpo: unknown) {
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
      throw erros.requisicaoInvalida("O corpo da requisição deve ser um objeto JSON");
    }
    this.dados = corpo as Record<string, unknown>;
  }

  tem(campo: string): boolean {
    return this.dados[campo] !== undefined;
  }

  texto(campo: string, maximo = 5000): string {
    const valor = this.textoOpcional(campo, maximo);
    if (valor === undefined) throw erros.requisicaoInvalida(`Campo obrigatório: ${campo}`);
    return valor;
  }

  textoOpcional(campo: string, maximo = 5000): string | undefined {
    const valor = this.dados[campo];
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor !== "string") throw erros.requisicaoInvalida(`${campo} deve ser texto`);
    const limpo = valor.trim();
    if (limpo === "") return undefined;
    if (limpo.length > maximo) throw erros.requisicaoInvalida(`${campo} excede ${maximo} caracteres`);
    return limpo;
  }

  enumeracao<T extends string>(campo: string, opcoes: readonly T[]): T {
    const valor = this.enumeracaoOpcional(campo, opcoes);
    if (valor === undefined) throw erros.requisicaoInvalida(`Campo obrigatório: ${campo}`);
    return valor;
  }

  enumeracaoOpcional<T extends string>(campo: string, opcoes: readonly T[]): T | undefined {
    const valor = this.dados[campo];
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor !== "string" || !(opcoes as readonly string[]).includes(valor)) {
      throw erros.requisicaoInvalida(`${campo} deve ser um de: ${opcoes.join(", ")}`);
    }
    return valor as T;
  }

  data(campo: string): Date {
    const valor = this.dataOpcional(campo);
    if (valor === undefined) throw erros.requisicaoInvalida(`Campo obrigatório: ${campo}`);
    return valor;
  }

  dataOpcional(campo: string): Date | undefined {
    const valor = this.dados[campo];
    if (valor === undefined || valor === null || valor === "") return undefined;
    if (typeof valor !== "string") throw erros.requisicaoInvalida(`${campo} deve ser uma data ISO 8601`);
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) throw erros.requisicaoInvalida(`${campo} deve ser uma data ISO 8601`);
    return data;
  }

  url(campo: string): string {
    const valor = this.urlOpcional(campo);
    if (valor === undefined) throw erros.requisicaoInvalida(`Campo obrigatório: ${campo}`);
    return valor;
  }

  urlOpcional(campo: string): string | undefined {
    const valor = this.textoOpcional(campo, 2000);
    if (valor === undefined) return undefined;
    try {
      const url = new URL(valor);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      return url.toString();
    } catch {
      throw erros.requisicaoInvalida(`${campo} deve ser uma URL http(s)`);
    }
  }

  uuid(campo: string): string {
    const valor = this.dados[campo];
    if (!ehUuid(valor)) throw erros.requisicaoInvalida(`${campo} deve ser um UUID`);
    return valor.toLowerCase();
  }

  listaTextos(campo: string, maximoItens = 20): string[] | undefined {
    const valor = this.dados[campo];
    if (valor === undefined || valor === null) return undefined;
    if (!Array.isArray(valor) || valor.some((item) => typeof item !== "string")) {
      throw erros.requisicaoInvalida(`${campo} deve ser uma lista de textos`);
    }
    const itens = [...new Set((valor as string[]).map((item) => item.trim().toLowerCase()).filter(Boolean))];
    if (itens.length > maximoItens) throw erros.requisicaoInvalida(`${campo} aceita no máximo ${maximoItens} itens`);
    return itens;
  }

  inteiroOpcional(campo: string, minimo: number, maximo: number): number | undefined {
    const valor = this.dados[campo];
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < minimo || valor > maximo) {
      throw erros.requisicaoInvalida(`${campo} deve ser inteiro entre ${minimo} e ${maximo}`);
    }
    return valor;
  }

  booleano(campo: string): boolean {
    const valor = this.dados[campo];
    if (typeof valor !== "boolean") throw erros.requisicaoInvalida(`${campo} deve ser booleano`);
    return valor;
  }
}

/** Lista de textos vinda da query string: ?tags=a,b ou ?tags=a&tags=b. */
export function listaDaQuery(valor: unknown): string[] {
  const partes = Array.isArray(valor) ? valor : valor === undefined ? [] : [valor];
  return [
    ...new Set(
      partes
        .flatMap((parte) => String(parte).split(","))
        .map((parte) => parte.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

export function textoDaQuery(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo === "" ? undefined : limpo;
}
