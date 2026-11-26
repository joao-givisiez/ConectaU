# syntax=docker/dockerfile:1
# Assistente: RAG (pgvector), agente LangChain, LLM da Groq com disjuntor, cache e fallback.
# Construir a partir da raiz do repositório:
#   docker build -f services/assistente/Dockerfile -t conectau/assistente:1.0.0 .
#
# Diferente dos outros serviços, este usa node:22-slim (Debian) e não Alpine: o modelo de embeddings
# roda no ONNX Runtime, cujos binários nativos exigem glibc.

# ---------- Estágio 1: build ----------
# Instala só as dependências deste serviço (e do pacote compartilhado), verifica os tipos e empacota
# o código num único arquivo JavaScript. As bibliotecas nativas ficam de fora do arquivo.
FROM node:22-slim AS build
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY services ./services
COPY bffs ./bffs
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace=@conectau/assistente --include-workspace-root
RUN npm run typecheck --workspace=@conectau/assistente && npm run build --workspace=@conectau/assistente

# ---------- Estágio 2: dependências nativas e modelo de embeddings ----------
# O ONNX Runtime e o modelo (~130 MB) são instalados e baixados aqui, uma vez. O estágio de execução
# só copia o resultado: o container sobe sem internet e sem esperar download.
FROM node:22-slim AS nativos
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    MODELOS_DIR=/app/modelos
COPY services/assistente/nativos/package.json services/assistente/nativos/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund \
 # Só Linux importa: remove os binários de macOS e Windows do ONNX Runtime e a versão para navegador.
 && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32 \
 && rm -rf node_modules/onnxruntime-web
COPY services/assistente/baixar-modelo.mjs ./
RUN node baixar-modelo.mjs && rm baixar-modelo.mjs

# ---------- Estágio 3: execução ----------
# Node.js, o arquivo empacotado, as bibliotecas nativas, o modelo e a base de conhecimento.
# Sem compilador, sem código-fonte e sem os pacotes de desenvolvimento.
FROM node:22-slim AS execucao
LABEL org.opencontainers.image.title="conectau-assistente" \
      org.opencontainers.image.description="Assistente: RAG, agente LangChain e LLM (Groq) com disjuntor, cache e fallback"
ENV NODE_ENV=production \
    PORT=3105 \
    MODELOS_DIR=/app/modelos \
    CONHECIMENTO_DIR=/app/conhecimento
WORKDIR /app
COPY --from=nativos --chown=node:node /app/node_modules ./node_modules
COPY --from=nativos --chown=node:node /app/modelos ./modelos
COPY --from=build --chown=node:node /app/services/assistente/dist ./dist
COPY --chown=node:node services/assistente/conhecimento ./conhecimento
USER node
EXPOSE 3105
# O /health só responde 200 depois de carregar o modelo e ingerir a base de conhecimento.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
