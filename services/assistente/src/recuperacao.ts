import type { Pool } from "pg";
import { paraPgvector, type ProvedorEmbeddings } from "./embeddings.js";

/** Um trecho recuperado da base vetorial. */
export interface Trecho {
  tipo: "CONHECIMENTO" | "OPORTUNIDADE";
  /** Nome do documento (conhecimento) ou id da oportunidade. */
  referencia: string;
  titulo: string;
  texto: string;
  fonteUrl: string | null;
  /** 1 − distância de cosseno. */
  similaridade: number;
}

export interface OpcoesRecuperacao {
  /** Quantos trechos devolver. */
  k?: number;
  /**
   * Conversa sobre um edital específico: os trechos de editais ficam restritos a ele, e ele tem cota
   * garantida no resultado (60% dos k trechos), para que a base de conhecimento, que costuma vencer
   * em perguntas genéricas, não esconda o próprio edital. Os documentos de conhecimento seguem valendo.
   */
  oportunidadeId?: string | undefined;
}

interface LinhaTrecho {
  tipo: "CONHECIMENTO" | "OPORTUNIDADE";
  referencia: string;
  titulo: string;
  texto: string;
  fonte_url: string | null;
  distancia: number;
}

/**
 * Recuperação: a etapa "R" do RAG. Vetoriza a pergunta e busca, numa única consulta, os trechos
 * mais próximos entre a base de conhecimento do domínio e o texto das oportunidades indexadas.
 */
export async function recuperar(
  pool: Pool,
  embeddings: ProvedorEmbeddings,
  pergunta: string,
  opcoes: OpcoesRecuperacao = {}
): Promise<Trecho[]> {
  const k = opcoes.k ?? 5;
  const vetor = paraPgvector(await embeddings.gerarConsulta(pergunta));
  // Sem escopo, editais e conhecimento competem só por similaridade. Com escopo, os melhores trechos
  // do edital da conversa (até a cota) vêm primeiro e o resto das vagas é completado por similaridade.
  const cotaEdital = opcoes.oportunidadeId ? Math.ceil(k * 0.6) : 0;
  const { rows } = await pool.query<LinhaTrecho>(
    `SELECT tipo, referencia, titulo, texto, fonte_url, distancia FROM (
       SELECT *, row_number() OVER (PARTITION BY tipo ORDER BY distancia) AS posicao FROM (
         SELECT 'OPORTUNIDADE' AS tipo, oportunidade_id::text AS referencia, titulo, texto, fonte_url,
                embedding <=> $1::vector AS distancia
           FROM chunks
          WHERE ($2::uuid IS NULL OR oportunidade_id = $2)
         UNION ALL
         SELECT 'CONHECIMENTO', documento, titulo_documento || ' — ' || secao, texto, NULL,
                embedding <=> $1::vector
           FROM base_conhecimento
       ) candidatos
     ) ordenados
     ORDER BY (tipo = 'OPORTUNIDADE' AND posicao <= $3) DESC, distancia
     LIMIT $4`,
    [vetor, opcoes.oportunidadeId ?? null, cotaEdital, k]
  );
  return rows.map((linha) => ({
    tipo: linha.tipo,
    referencia: linha.referencia,
    titulo: linha.titulo,
    texto: linha.texto,
    fonteUrl: linha.fonte_url,
    similaridade: Math.round((1 - Number(linha.distancia)) * 1000) / 1000
  }));
}

/** Texto que vai para o prompt: cada trecho recebe o rótulo [F#] que o modelo deve citar. */
export function formatarTrechos(trechos: Trecho[], rotulos: string[]): string {
  if (trechos.length === 0) return "(nenhum trecho encontrado)";
  return trechos
    .map((t, i) => {
      const origem = t.tipo === "CONHECIMENTO" ? "base de conhecimento" : "edital de oportunidade publicada";
      const link = t.fonteUrl ? ` · fonte oficial: ${t.fonteUrl}` : "";
      return `[${rotulos[i] ?? "F?"}] (${origem}: ${t.titulo}${link})\n${t.texto}`;
    })
    .join("\n\n");
}
