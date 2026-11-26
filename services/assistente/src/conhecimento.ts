import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { transacao } from "@conectau/comum";
import { dividirEmTrechos, paraPgvector, type ProvedorEmbeddings } from "./embeddings.js";

/**
 * Ingestão da base de conhecimento: lê os documentos Markdown da pasta conhecimento/, divide cada
 * um por seção (## ...) e em trechos, gera os embeddings e grava no pgvector.
 * É idempotente: só reprocessa o documento cujo conteúdo (hash) mudou, e remove os que sumiram.
 */
export interface ResumoIngestao {
  documentos: number;
  trechos: number;
  atualizados: string[];
  removidos: string[];
}

interface TrechoDocumento {
  secao: string;
  texto: string;
}

export function dividirDocumento(markdown: string): { titulo: string; trechos: TrechoDocumento[] } {
  const linhas = markdown.replace(/\r\n/g, "\n").split("\n");
  const titulo = linhas.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "Documento";
  const secoes: { nome: string; linhas: string[] }[] = [];
  for (const linha of linhas) {
    if (linha.startsWith("## ")) secoes.push({ nome: linha.slice(3).trim(), linhas: [] });
    else if (!linha.startsWith("# ")) secoes.at(-1)?.linhas.push(linha);
  }
  const trechos: TrechoDocumento[] = [];
  for (const secao of secoes) {
    const corpo = secao.linhas.join("\n").trim();
    if (!corpo) continue;
    for (const texto of dividirEmTrechos(corpo)) trechos.push({ secao: secao.nome, texto });
  }
  return { titulo, trechos };
}

export async function ingerirConhecimento(
  pool: Pool,
  embeddings: ProvedorEmbeddings,
  pasta: string
): Promise<ResumoIngestao> {
  const arquivos = (await readdir(pasta)).filter((a) => a.endsWith(".md")).sort();
  const existentes = new Map(
    (
      await pool.query<{ documento: string; hash: string }>(
        "SELECT documento, max(hash_documento) AS hash FROM base_conhecimento GROUP BY documento"
      )
    ).rows.map((l) => [l.documento, l.hash])
  );

  const atualizados: string[] = [];
  for (const arquivo of arquivos) {
    const conteudo = await readFile(join(pasta, arquivo), "utf8");
    const hash = createHash("sha256").update(conteudo).digest("hex");
    if (existentes.get(arquivo) === hash) continue;

    const { titulo, trechos } = dividirDocumento(conteudo);
    const vetores = await embeddings.gerarDocumentos(trechos.map((t) => `${titulo} — ${t.secao}\n${t.texto}`));
    await transacao(pool, async (cliente) => {
      await cliente.query("DELETE FROM base_conhecimento WHERE documento = $1", [arquivo]);
      for (const [ordem, trecho] of trechos.entries()) {
        await cliente.query(
          `INSERT INTO base_conhecimento (id, documento, titulo_documento, secao, ordem, texto, hash_documento, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
          [randomUUID(), arquivo, titulo, trecho.secao, ordem, trecho.texto, hash, paraPgvector(vetores[ordem]!)]
        );
      }
    });
    atualizados.push(arquivo);
  }

  const removidos = [...existentes.keys()].filter((documento) => !arquivos.includes(documento));
  if (removidos.length > 0) {
    await pool.query("DELETE FROM base_conhecimento WHERE documento = ANY($1::text[])", [removidos]);
  }
  if (atualizados.length > 0 || removidos.length > 0) await incrementarVersaoDoIndice(pool);

  const { rows } = await pool.query<{ documentos: string; trechos: string }>(
    "SELECT count(DISTINCT documento) AS documentos, count(*) AS trechos FROM base_conhecimento"
  );
  return {
    documentos: Number(rows[0]?.documentos ?? 0),
    trechos: Number(rows[0]?.trechos ?? 0),
    atualizados,
    removidos
  };
}

/** Qualquer mudança no conteúdo indexado sobe a versão, o que invalida as respostas em cache. */
export async function incrementarVersaoDoIndice(pool: Pool): Promise<void> {
  await pool.query("UPDATE indice_estado SET valor = (valor::bigint + 1)::text WHERE chave = 'versao'");
}
