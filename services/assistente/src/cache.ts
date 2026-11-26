import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { paraPgvector } from "./embeddings.js";
import type { FonteConsultada } from "./tipos.js";

/**
 * Cache das respostas do LLM, em duas camadas:
 *  1. por chave: pergunta normalizada + escopo + versão do índice (acerto exato);
 *  2. semântico: pergunta diferente, mas com embedding quase idêntico (ex.: "como crio um lembrete?"
 *     e "como faço para criar lembrete?").
 * A versão do índice entra na chave e na busca semântica: mudou o conteúdo indexado, as respostas
 * antigas deixam de valer.
 */
export interface RespostaEmCache {
  resposta: string;
  fontes: FonteConsultada[];
  modelo: string;
}

export interface AcertoDeCache {
  resposta: RespostaEmCache;
  tipo: "exato" | "semantico";
  similaridade: number;
}

export function normalizarPergunta(pergunta: string): string {
  return pergunta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chaveDoCache(pergunta: string, escopo: string, versao: number): string {
  return createHash("sha256").update(`${normalizarPergunta(pergunta)}|${escopo}|${versao}`).digest("hex");
}

export async function lerVersaoDoIndice(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ valor: string }>("SELECT valor FROM indice_estado WHERE chave = 'versao'");
  return Number(rows[0]?.valor ?? 1);
}

export async function buscarNoCache(
  pool: Pool,
  consulta: { pergunta: string; escopo: string; versao: number; vetor: number[]; similaridadeMinima: number }
): Promise<AcertoDeCache | undefined> {
  const chave = chaveDoCache(consulta.pergunta, consulta.escopo, consulta.versao);
  const exato = await pool.query<{ resposta: RespostaEmCache }>(
    "UPDATE cache_respostas SET acertos = acertos + 1 WHERE chave = $1 AND expira_em > now() RETURNING resposta",
    [chave]
  );
  if (exato.rows[0]) return { resposta: exato.rows[0].resposta, tipo: "exato", similaridade: 1 };

  const { rows } = await pool.query<{ chave: string; resposta: RespostaEmCache; similaridade: number }>(
    `SELECT chave, resposta, 1 - (embedding <=> $1::vector) AS similaridade
       FROM cache_respostas
      WHERE escopo = $2 AND versao_indice = $3 AND expira_em > now()
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [paraPgvector(consulta.vetor), consulta.escopo, consulta.versao]
  );
  const candidato = rows[0];
  if (!candidato || Number(candidato.similaridade) < consulta.similaridadeMinima) return undefined;
  await pool.query("UPDATE cache_respostas SET acertos = acertos + 1 WHERE chave = $1", [candidato.chave]);
  return { resposta: candidato.resposta, tipo: "semantico", similaridade: Number(candidato.similaridade) };
}

export async function gravarNoCache(
  pool: Pool,
  entrada: {
    pergunta: string;
    escopo: string;
    versao: number;
    vetor: number[];
    resposta: RespostaEmCache;
    ttlMinutos: number;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO cache_respostas (chave, escopo, versao_indice, pergunta, embedding, resposta, expira_em)
     VALUES ($1, $2, $3, $4, $5::vector, $6, now() + make_interval(mins => $7))
     ON CONFLICT (chave) DO UPDATE
        SET resposta = EXCLUDED.resposta, embedding = EXCLUDED.embedding, expira_em = EXCLUDED.expira_em`,
    [
      chaveDoCache(entrada.pergunta, entrada.escopo, entrada.versao),
      entrada.escopo,
      entrada.versao,
      entrada.pergunta,
      paraPgvector(entrada.vetor),
      JSON.stringify(entrada.resposta),
      entrada.ttlMinutos
    ]
  );
  await pool.query("DELETE FROM cache_respostas WHERE expira_em < now() - interval '1 day'");
}
