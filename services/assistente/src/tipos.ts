/** Tipos compartilhados entre recuperação, ferramentas, cadeias e as rotas do Assistente. */

/** De onde veio um trecho usado para responder. */
export type TipoFonte = "CONHECIMENTO" | "OPORTUNIDADE" | "CATALOGO";

export interface FonteConsultada {
  /** Rótulo citado pelo modelo na resposta: F1, F2... */
  id: string;
  tipo: TipoFonte;
  titulo: string;
  trecho: string;
  fonteUrl?: string;
  oportunidadeId?: string;
  documento?: string;
  similaridade?: number;
  /** O modelo citou este rótulo (por exemplo [F2]) na resposta final. */
  citada: boolean;
}

export interface ChamadaFerramenta {
  nome: string;
  duracaoMs: number;
  erro?: string;
}

/** Estado de uma pergunta em andamento, preenchido pelas ferramentas à medida que são usadas. */
export interface ContextoPergunta {
  /** Conversa sobre um edital específico: a recuperação fica restrita a ele. */
  oportunidadeId?: string;
  fontes: FonteConsultada[];
  chamadas: ChamadaFerramenta[];
  requestId?: string;
}

export type ModoExecucao = "agente" | "rag" | "sem-recuperacao" | "recuperacao";

export const MODOS: readonly ModoExecucao[] = ["agente", "rag", "sem-recuperacao", "recuperacao"];

/** RECUSA: pergunta fora do escopo do ConectaU, barrada antes do LLM. */
export type OrigemResposta = "LLM" | "CACHE" | "FALLBACK" | "RECUSA";

export type MotivoDegradacao =
  | "SEM_CHAVE"
  | "CIRCUITO_ABERTO"
  | "PROVEDOR_INDISPONIVEL"
  | "TEMPO_ESGOTADO"
  | "LIMITE_DO_PROVEDOR"
  | "CHAVE_INVALIDA"
  | "SOLICITADO"
  | "ERRO_INESPERADO";
