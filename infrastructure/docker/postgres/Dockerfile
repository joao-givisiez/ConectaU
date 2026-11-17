FROM postgres:17-alpine

LABEL org.opencontainers.image.title="ConectaU PostgreSQL"
LABEL org.opencontainers.image.description="Imagem personalizada do banco de dados do ConectaU"

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
