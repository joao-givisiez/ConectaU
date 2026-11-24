# syntax=docker/dockerfile:1
# BFF Web: agrega serviços para o Portal Web.
# Construir a partir da raiz do repositório:
#   docker build -f bffs/bff-web/Dockerfile -t conectau/bff-web:1.0.0 .

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
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
RUN npm run typecheck --workspace=@conectau/bff-web  && npm run build --workspace=@conectau/bff-web

# ---------- Estágio 2: execução ----------
# Só o Node.js e o arquivo empacotado: sem node_modules, sem compilador e sem código-fonte.
# A imagem final fica com uma fração do tamanho do estágio de build e menos superfície de ataque.
FROM node:22-alpine AS execucao
LABEL org.opencontainers.image.title="conectau-bff-web"       org.opencontainers.image.description="BFF Web: agrega serviços para o Portal Web"
ENV NODE_ENV=production     PORT=3201
WORKDIR /app
COPY --from=build --chown=node:node /app/bffs/bff-web/dist ./dist
USER node
EXPOSE 3201
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3   CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.cjs"]
