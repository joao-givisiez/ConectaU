/**
 * Provedor de embeddings do Assistente.
 *
 * Os embeddings são gerados LOCALMENTE, dentro do próprio serviço, com o modelo multilíngue
 * multilingual-e5-small (384 dimensões) executado em ONNX por transformers.js. Motivos:
 *  - o provedor de LLM (Groq) não oferece embeddings, e uma segunda API paga só para isso
 *    traria outra chave, outro custo e outra dependência remota falível;
 *  - o modelo entende português e capta sentido, não apenas palavras iguais;
 *  - o modelo é baixado na construção da imagem Docker, então o container sobe sem rede.
 *
 * O modelo e5 pede prefixos: "query: " na pergunta e "passage: " nos trechos indexados.
 */
export interface ProvedorEmbeddings {
  readonly nome: string;
  readonly dimensoes: number;
  pronto(): boolean;
  carregar(): Promise<void>;
  gerarConsulta(texto: string): Promise<number[]>;
  gerarDocumentos(textos: string[]): Promise<number[][]>;
}

type Extrator = (
  textos: string[],
  opcoes: { pooling: "mean"; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

export interface OpcoesEmbeddings {
  modelo: string;
  /** Pasta com o modelo já baixado. Se definida, o serviço não acessa a internet para carregá-lo. */
  pastaModelos: string | undefined;
}

export class EmbeddingsMultilingues implements ProvedorEmbeddings {
  readonly dimensoes = 384;
  private extrator: Extrator | undefined;
  private carregando: Promise<void> | undefined;
  /** Fila: o ONNX roda um lote por vez, o que mantém a latência previsível sob carga. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly opcoes: OpcoesEmbeddings) {}

  get nome(): string {
    return this.opcoes.modelo;
  }

  pronto(): boolean {
    return this.extrator !== undefined;
  }

  carregar(): Promise<void> {
    this.carregando ??= this.carregarModelo().catch((erro: unknown) => {
      this.carregando = undefined;
      throw erro;
    });
    return this.carregando;
  }

  private async carregarModelo(): Promise<void> {
    const { pipeline, env } = await import("@huggingface/transformers");
    if (this.opcoes.pastaModelos) {
      env.localModelPath = this.opcoes.pastaModelos;
      env.cacheDir = this.opcoes.pastaModelos;
      env.allowRemoteModels = false;
    }
    const extrator = await pipeline("feature-extraction", this.opcoes.modelo, { dtype: "q8" });
    this.extrator = extrator as unknown as Extrator;
  }

  async gerarConsulta(texto: string): Promise<number[]> {
    const [vetor] = await this.gerar([`query: ${texto}`]);
    return vetor ?? [];
  }

  gerarDocumentos(textos: string[]): Promise<number[][]> {
    return this.gerar(textos.map((t) => `passage: ${t}`));
  }

  private gerar(textos: string[]): Promise<number[][]> {
    const execucao = this.fila.then(async () => {
      await this.carregar();
      const extrator = this.extrator;
      if (!extrator) throw new Error("Modelo de embeddings indisponível");
      const vetores: number[][] = [];
      for (let i = 0; i < textos.length; i += 8) {
        const saida = await extrator(textos.slice(i, i + 8), { pooling: "mean", normalize: true });
        vetores.push(...saida.tolist());
      }
      return vetores;
    });
    this.fila = execucao.catch(() => undefined);
    return execucao;
  }
}

/** Formato textual aceito pelo pgvector: [0.1,0.2,...]. */
export function paraPgvector(vetor: number[]): string {
  return `[${vetor.map((v) => Math.round(v * 1e6) / 1e6).join(",")}]`;
}

/** Divide o texto em trechos de até ~700 caracteres, respeitando frases, com uma frase de sobreposição. */
export function dividirEmTrechos(texto: string, tamanho = 700): string[] {
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
