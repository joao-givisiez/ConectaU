// Empacota um serviço TypeScript num único arquivo JavaScript (CommonJS) com esbuild.
// Uso (a partir da pasta do workspace):
//   node ../../scripts/empacotar.mjs src/index.ts [src/outro.ts ...] [--externas=pacote-a,pacote-b]
//
// --externas: pacotes com binários nativos (ex.: ONNX Runtime), que não podem ir dentro do arquivo
// e precisam estar em node_modules na imagem final (ver services/assistente/Dockerfile).
//
// Por que empacotar: a imagem final do container recebe apenas os arquivos de dist/,
// sem node_modules, compilador ou código-fonte (ver Dockerfiles multi-stage).
import { build } from "esbuild";

const argumentos = process.argv.slice(2);
const entradas = argumentos.filter((a) => !a.startsWith("--"));
const externas = argumentos
  .filter((a) => a.startsWith("--externas="))
  .flatMap((a) => a.slice("--externas=".length).split(","))
  .filter(Boolean);
if (entradas.length === 0) {
  console.error("Informe ao menos um arquivo de entrada.");
  process.exit(1);
}

await build({
  entryPoints: entradas,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  // Dependências opcionais do driver do MongoDB, carregadas apenas se existirem.
  external: [
    "kerberos",
    "@mongodb-js/zstd",
    "@aws-sdk/credential-providers",
    "gcp-metadata",
    "snappy",
    "socks",
    "aws4",
    "mongodb-client-encryption",
    "pg-native",
    ...externas
  ]
});
