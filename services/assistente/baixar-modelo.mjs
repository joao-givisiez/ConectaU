// Baixa o modelo de embeddings para dentro da imagem Docker (executado uma vez, na construção).
// Assim o container sobe sem acesso à internet e sem esperar um download de ~130 MB.
import { env, pipeline } from "@huggingface/transformers";

const modelo = process.env.EMBEDDINGS_MODELO || "Xenova/multilingual-e5-small";
env.cacheDir = process.env.MODELOS_DIR || "./modelos";

const extrator = await pipeline("feature-extraction", modelo, { dtype: "q8" });
const saida = await extrator(["passage: teste de carga do modelo"], { pooling: "mean", normalize: true });
const dimensoes = saida.dims.at(-1);
if (dimensoes !== 384) throw new Error(`O modelo ${modelo} gera ${dimensoes} dimensões; o esquema espera 384.`);
console.log(`Modelo ${modelo} pronto em ${env.cacheDir} (${dimensoes} dimensões).`);
