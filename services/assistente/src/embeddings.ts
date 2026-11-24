import { createHash } from "node:crypto";

/**
 * Provedor de embeddings. Nesta etapa (Parte 3) o Assistente usa um provedor LOCAL e
 * determinístico, sem rede: um vetor de 256 posições obtido por "hashing" das palavras.
 * Ele permite testar de ponta a ponta a indexação, o pgvector e a busca por similaridade.
 * Na Parte 4, um provedor remoto de embeddings implementa esta mesma interface.
 */
export interface ProvedorEmbeddings {
  readonly nome: string;
  readonly dimensoes: number;
  gerar(texto: string): Promise<number[]>;
}

const STOPWORDS = new Set(
  "a o as os um uma de da do das dos e em no na nos nas para por com sem que se ao aos ou como mais ser sao foi ate sobre entre este esta isso".split(
    " "
  )
);

export function palavras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !STOPWORDS.has(p));
}

export class EmbeddingsLocais implements ProvedorEmbeddings {
  readonly nome = "local-hashing";
  readonly dimensoes = 256;

  async gerar(texto: string): Promise<number[]> {
    const vetor = new Array<number>(this.dimensoes).fill(0);
    const termos = palavras(texto);
    const somar = (termo: string, peso: number) => {
      const hash = createHash("md5").update(termo).digest();
      const indice = hash.readUInt16BE(0) % this.dimensoes;
      const sinal = (hash[2] ?? 0) & 1 ? 1 : -1;
      vetor[indice] = (vetor[indice] ?? 0) + sinal * peso;
    };
    termos.forEach((termo, i) => {
      somar(termo, 1);
      // Prefixo de 5 letras aproxima variações (inscrição/inscrições, bolsa/bolsas).
      if (termo.length > 5) somar(termo.slice(0, 5), 0.5);
      const proximo = termos[i + 1];
      if (proximo) somar(`${termo}_${proximo}`, 0.5);
    });
    const norma = Math.sqrt(vetor.reduce((soma, v) => soma + v * v, 0)) || 1;
    return vetor.map((v) => Math.round((v / norma) * 1e6) / 1e6);
  }
}

/** Formato textual aceito pelo pgvector: [0.1,0.2,...]. */
export function paraPgvector(vetor: number[]): string {
  return `[${vetor.join(",")}]`;
}

/** Divide o texto em trechos de até ~600 caracteres, respeitando frases, com uma frase de sobreposição. */
export function dividirEmTrechos(texto: string, tamanho = 600): string[] {
  const frases = texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
  const trechos: string[] = [];
  let atual: string[] = [];
  for (const frase of frases) {
    if (atual.length > 0 && [...atual, frase].join(" ").length > tamanho) {
      trechos.push(atual.join(" "));
      atual = [atual[atual.length - 1]!];
    }
    atual.push(frase);
  }
  if (atual.length > 0) trechos.push(atual.join(" "));
  return trechos;
}
