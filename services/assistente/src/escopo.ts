import type { Pool } from "@conectau/comum";
import { paraPgvector } from "./embeddings.js";

/**
 * Guarda de escopo: decide, ANTES de chamar o LLM, se a pergunta é sobre o ConectaU.
 * O assistente só responde sobre oportunidades acadêmicas e o funcionamento da plataforma; o resto
 * recebe uma recusa fixa, sem gastar tokens. A instrução de recusa no prompt do agente continua como
 * segunda camada, mas esta primeira não depende de o modelo obedecer.
 *
 * Ordem das regras:
 *  1. tentativa de manipular o assistente ("ignore as instruções", "finja ser"...) → recusa;
 *  2. cumprimento curto ("oi", "obrigado") → segue (o agente responde sem ferramentas);
 *  3. em todo o resto, a pergunta precisa ser semanticamente próxima da base de conhecimento ou de um
 *     edital indexado. Um termo do domínio (bolsa, edital, prazo...) só reduz a similaridade exigida:
 *     sozinho ele não libera a pergunta, porque palavras como "curso" ou "projeto" também aparecem
 *     fora do contexto acadêmico. Os limiares foram calibrados para o modelo e5 (ver docs/parte-4).
 */
export type MotivoEscopo = "PROXIMA_DA_BASE" | "CUMPRIMENTO" | "FORA_DO_DOMINIO" | "MANIPULACAO";

export interface AvaliacaoDeEscopo {
  dentro: boolean;
  motivo: MotivoEscopo;
  /** Maior similaridade entre a pergunta e os trechos indexados. */
  similaridade?: number;
  /** A pergunta contém um termo do domínio (reduz a similaridade exigida). */
  termoDoDominio?: boolean;
}

export const RESPOSTA_FORA_DO_ESCOPO =
  "Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e " +
  "processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da " +
  "plataforma. Reformule a sua pergunta sobre um desses temas.";

const MANIPULACAO =
  /\b(ignore|ignora|desconsidere|desconsidera|esque[cç]a|esquece)\b.{0,40}\b(instru[cç][oõ]es|regras|orienta[cç][oõ]es|prompt)\b|\b(prompt|mensagem) (do|de) sistema\b|\bsystem prompt\b|\bvoc[eê] agora [eé]\b|\bfinja (que|ser)\b|\bjailbreak\b|\bmodo desenvolvedor\b|\bignore (all|previous)\b/i;

const CUMPRIMENTO = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem)\b[\s!?.,]*$/i;

/** Radicais de termos do domínio (sem acento, minúsculos). Reduzem o limiar; não liberam sozinhos. */
const TERMOS_DO_DOMINIO = [
  "conectau", "ufla", "oportunidad", "bolsa", "bolsist", "edital", "editai", "monitor", "iniciacao cientifica",
  "pesquisa", "extensao", "estagio", "evento", "palestra", "workshop", "minicurso", "semana academica",
  "processo seletivo", "selecao", "empresa junior", "inscri", "prazo", "vaga", "requisit", "lembrete",
  "favorit", "aviso", "notifica", "curadoria", "campus", "lavras", "paraiso", "certificado",
  "horas complementares", "atividades complementares", "atividade", "projeto", "voluntari", "fonte oficial",
  "categoria", "perfil", "interesse", "cadastr", "privacidade", "historico escolar", "carta de interesse",
  "curso", "disciplina", "graduacao", "professor", "orientador", "universidade", "academic"
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface LimiaresDeEscopo {
  /** Similaridade mínima para uma pergunta sem nenhum termo do domínio. */
  semTermo: number;
  /** Similaridade mínima quando a pergunta tem um termo do domínio. */
  comTermo: number;
}

export async function avaliarEscopo(
  pool: Pool,
  pergunta: string,
  vetor: number[],
  limiares: LimiaresDeEscopo
): Promise<AvaliacaoDeEscopo> {
  if (MANIPULACAO.test(pergunta)) return { dentro: false, motivo: "MANIPULACAO" };
  if (CUMPRIMENTO.test(pergunta.trim())) return { dentro: true, motivo: "CUMPRIMENTO" };
  const normalizada = normalizar(pergunta);
  const termoDoDominio = TERMOS_DO_DOMINIO.some((termo) => normalizada.includes(termo));

  // Maior similaridade com qualquer trecho indexado (base de conhecimento ou edital). Na calibração, a
  // média dos 3 mais próximos não separou melhor as perguntas dentro e fora do escopo.
  const { rows } = await pool.query<{ similaridade: number | null }>(
    `SELECT greatest(
       (SELECT 1 - (embedding <=> $1::vector) FROM base_conhecimento ORDER BY embedding <=> $1::vector LIMIT 1),
       (SELECT 1 - (embedding <=> $1::vector) FROM chunks ORDER BY embedding <=> $1::vector LIMIT 1)
     ) AS similaridade`,
    [paraPgvector(vetor)]
  );
  const similaridade = Math.round(Number(rows[0]?.similaridade ?? 0) * 1000) / 1000;
  const minima = termoDoDominio ? limiares.comTermo : limiares.semTermo;
  return similaridade >= minima
    ? { dentro: true, motivo: "PROXIMA_DA_BASE", similaridade, termoDoDominio }
    : { dentro: false, motivo: "FORA_DO_DOMINIO", similaridade, termoDoDominio };
}
