import { randomUUID } from "node:crypto";
import { transacao, type Evento, type Log, type Pool } from "@conectau/comum";
import { incrementarVersaoDoIndice } from "./conhecimento.js";
import { dividirEmTrechos, paraPgvector, type ProvedorEmbeddings } from "./embeddings.js";

/**
 * Índice vetorial dos editais (tabela chunks).
 *  - A SAGA de publicação indexa (PUT /internal/indexacoes) e compensa (DELETE) de forma síncrona.
 *  - Depois de publicada, a oportunidade é mantida em dia pelos eventos da outbox: editada → reindexa
 *    com o texto novo; encerrada → sai do índice, para o assistente não citar um edital fechado.
 */
export interface DadosIndexacao {
  oportunidadeId: string;
  sagaId?: string | undefined;
  titulo: string;
  texto: string;
  fonteUrl?: string | undefined;
}

/** Substitui os trechos da oportunidade numa única transação (idempotente). */
export async function indexarOportunidade(
  pool: Pool,
  embeddings: ProvedorEmbeddings,
  dados: DadosIndexacao
): Promise<number> {
  const { oportunidadeId, titulo, texto } = dados;
  const trechos = dividirEmTrechos(texto.startsWith(titulo) ? texto : `${titulo}. ${texto}`);
  // O título acompanha cada trecho no embedding: um pedaço solto ("12 horas semanais") fica ligado ao edital.
  const vetores = await embeddings.gerarDocumentos(trechos.map((t) => `${titulo}\n${t}`));
  await transacao(pool, async (cliente) => {
    await cliente.query("DELETE FROM chunks WHERE oportunidade_id = $1", [oportunidadeId]);
    for (const [ordem, trecho] of trechos.entries()) {
      await cliente.query(
        `INSERT INTO chunks (id, oportunidade_id, saga_id, ordem, titulo, texto, fonte_url, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
        [
          randomUUID(),
          oportunidadeId,
          dados.sagaId ?? null,
          ordem,
          titulo,
          trecho,
          dados.fonteUrl ?? null,
          paraPgvector(vetores[ordem]!)
        ]
      );
    }
  });
  await incrementarVersaoDoIndice(pool);
  return trechos.length;
}

export async function removerOportunidade(pool: Pool, oportunidadeId: string): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM chunks WHERE oportunidade_id = $1", [oportunidadeId]);
  if ((rowCount ?? 0) > 0) await incrementarVersaoDoIndice(pool);
  return rowCount ?? 0;
}

/** Retrato publicado pelos eventos de Oportunidades (só os campos usados aqui). */
interface RetratoOportunidade {
  id: string;
  titulo: string;
  descricao?: string | null;
  categoria: string;
  campus: string;
  dataInicio?: string | null;
  prazoInscricao: string;
  fonteUrl?: string | null;
  tags?: string[];
  status: string;
}

/** Mesmo texto que a SAGA envia na publicação, montado a partir do retrato do evento. */
export function textoDoRetrato(o: RetratoOportunidade): string {
  return [
    o.titulo,
    o.descricao ?? "",
    `Categoria: ${o.categoria}. Campus: ${o.campus}.`,
    o.dataInicio ? `Início: ${o.dataInicio.slice(0, 10)}.` : "",
    `Prazo de inscrição: ${o.prazoInscricao.slice(0, 10)}.`,
    o.tags?.length ? `Temas: ${o.tags.join(", ")}.` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function criarTratadorDeEventos(pool: Pool, embeddings: ProvedorEmbeddings, log: Log) {
  return async (evento: Evento): Promise<void> => {
    const o = evento.payload as unknown as RetratoOportunidade;
    if (evento.tipo === "OportunidadeEncerrada") {
      const removidos = await removerOportunidade(pool, o.id);
      log.info(`Evento ${evento.tipo}: ${removidos} trecho(s) removido(s) do índice`, { oportunidadeId: o.id });
      return;
    }
    if (evento.tipo === "OportunidadeEditada" && o.status === "PUBLICADA") {
      // Só reindexa o que ainda está no índice: um evento de edição atrasado, que chegue depois do
      // encerramento, não pode trazer de volta uma oportunidade encerrada.
      const { rows } = await pool.query("SELECT 1 FROM chunks WHERE oportunidade_id = $1 LIMIT 1", [o.id]);
      if (rows.length === 0) return;
      const trechos = await indexarOportunidade(pool, embeddings, {
        oportunidadeId: o.id,
        titulo: o.titulo,
        texto: textoDoRetrato(o),
        fonteUrl: o.fonteUrl ?? undefined
      });
      log.info(`Evento ${evento.tipo}: oportunidade reindexada em ${trechos} trecho(s)`, { oportunidadeId: o.id });
    }
  };
}
