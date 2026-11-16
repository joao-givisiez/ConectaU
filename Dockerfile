FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/identidade/package.json ./services/identidade/package.json

RUN npm ci

COPY . .

RUN npm run typecheck --workspace=@conectau/identidade

RUN npx tsc -p services/identidade/tsconfig.json --noEmit false --outDir services/identidade/dist --rootDir services/identidade/src

RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3101

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/services/identidade/package.json ./services/identidade/package.json
COPY --from=build --chown=node:node /app/services/identidade/dist ./services/identidade/dist

USER node

EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/identidade/dist/index.js"]
