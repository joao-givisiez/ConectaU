# syntax=docker/dockerfile:1
# Coleta: fontes, coletor, deduplicação e fila de curadoria.
# Construir a partir da raiz do repositório:
#   docker build -f services/coleta/Dockerfile -t conectau/coleta:1.0.0 .

# ---------- Estágio 1: build ----------
# Instala todas as dependências (inclusive TypeScript e esbuild), verifica os tipos
# e empacota o serviço, com o código compartilhado, num único arquivo JavaScript.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY services ./services
COPY bffs ./bffs
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace=@conectau/coleta --include-workspace-root
RUN npm run typecheck --workspace=@conectau/coleta  && npm run build --workspace=@conectau/coleta

# ---------- Estágio 2: execução ----------
# Só o Node.js e o arquivo empacotado: sem node_modules, sem compilador e sem código-fonte.
# A imagem final fica com uma fração do tamanho do estágio de build e menos superfície de ataque.
FROM node:22-alpine AS execucao
LABEL org.opencontainers.image.title="conectau-coleta"       org.opencontainers.image.description="Coleta: fontes, coletor, deduplicação e fila de curadoria"
ENV NODE_ENV=production     PORT=3102
WORKDIR /app
COPY --from=build --chown=node:node /app/services/coleta/dist ./dist
USER node
EXPOSE 3102
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3   CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
