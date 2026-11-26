import type { Pool } from "@conectau/comum";

/**
 * Métricas das respostas (latência, tokens e custo estimado), agregadas a partir da tabela
 * `mensagens`. Alimentam a análise de latência e custo da Parte 4.
 */
interface LinhaAgregada {
  origem: string;
  modo: string;
  total: string;
  media_ms: string | null;
  p50_ms: number | null;
  p95_ms: number | null;
  tokens_entrada: string;
  tokens_saida: string;
  custo: string;
}

export interface GrupoDeMetricas {
  origem: string;
  modo: string;
  respostas: number;
  latenciaMs: { media: number; p50: number; p95: number };
  tokens: { entrada: number; saida: number; entradaMedia: number; saidaMedia: number };
  custoEstimadoUsd: { total: number; medioPorResposta: number };
}

export async function calcularMetricas(pool: Pool, horas: number) {
  const { rows } = await pool.query<LinhaAgregada>(
    `SELECT origem, modo, count(*) AS total, round(avg(latencia_ms)) AS media_ms,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latencia_ms) AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS p95_ms,
            coalesce(sum(tokens_entrada), 0) AS tokens_entrada,
            coalesce(sum(tokens_saida), 0) AS tokens_saida,
            coalesce(sum(custo_estimado_usd), 0) AS custo
       FROM mensagens
      WHERE criada_em > now() - make_interval(hours => $1)
      GROUP BY origem, modo
      ORDER BY origem, modo`,
    [horas]
  );
  const grupos: GrupoDeMetricas[] = rows.map((l) => {
    const respostas = Number(l.total);
    const entrada = Number(l.tokens_entrada);
    const saida = Number(l.tokens_saida);
    const custo = Number(l.custo);
    return {
      origem: l.origem,
      modo: l.modo,
      respostas,
      latenciaMs: {
        media: Number(l.media_ms ?? 0),
        p50: Math.round(l.p50_ms ?? 0),
        p95: Math.round(l.p95_ms ?? 0)
      },
      tokens: {
        entrada,
        saida,
        entradaMedia: Math.round(entrada / respostas),
        saidaMedia: Math.round(saida / respostas)
      },
      custoEstimadoUsd: { total: custo, medioPorResposta: custo / respostas }
    };
  });
  const total = grupos.reduce((soma, g) => soma + g.respostas, 0);
  const porOrigem = (origem: string) => grupos.filter((g) => g.origem === origem).reduce((s, g) => s + g.respostas, 0);
  return {
    janelaHoras: horas,
    respostas: total,
    porOrigem: { llm: porOrigem("LLM"), cache: porOrigem("CACHE"), fallback: porOrigem("FALLBACK"), recusa: porOrigem("RECUSA") },
    taxaDeCache: total === 0 ? 0 : porOrigem("CACHE") / total,
    taxaDeFallback: total === 0 ? 0 : porOrigem("FALLBACK") / total,
    custoEstimadoTotalUsd: grupos.reduce((soma, g) => soma + g.custoEstimadoUsd.total, 0),
    grupos
  };
}
