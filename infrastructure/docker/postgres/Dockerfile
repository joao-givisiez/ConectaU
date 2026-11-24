# Imagem de banco PostgreSQL de um serviço do ConectaU.
# Cada serviço gera a sua própria imagem, com o próprio esquema embutido (database per service):
#
#   docker build -f infrastructure/docker/postgres/Dockerfile \
#     --build-arg ESQUEMA=services/identidade/db/init.sql -t conectau/identidade-db:1.0.0 .
#
# O Assistente usa a base com a extensão pgvector:
#   --build-arg IMAGEM_BASE=pgvector/pgvector:pg17

ARG IMAGEM_BASE=postgres:17-alpine
FROM ${IMAGEM_BASE}

ARG ESQUEMA
LABEL org.opencontainers.image.title="conectau-postgres" \
      org.opencontainers.image.description="PostgreSQL com o esquema de um serviço do ConectaU"

# Executado pelo entrypoint oficial apenas na primeira inicialização (volume vazio).
COPY ${ESQUEMA} /docker-entrypoint-initdb.d/01-esquema.sql

ENV TZ=America/Sao_Paulo

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
