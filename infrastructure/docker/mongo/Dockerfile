# Banco MongoDB do serviço Coleta, com usuário de menor privilégio e índices criados na inicialização.
#   docker build -f infrastructure/docker/mongo/Dockerfile -t conectau/coleta-db:1.0.0 .
FROM mongo:8.0

LABEL org.opencontainers.image.title="conectau-coleta-db" \
      org.opencontainers.image.description="MongoDB do serviço Coleta do ConectaU"

# Executado pelo entrypoint oficial apenas na primeira inicialização (volume vazio).
COPY services/coleta/db/init.js /docker-entrypoint-initdb.d/01-coleta.js

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD mongosh --quiet --eval "quit(db.adminCommand('ping').ok ? 0 : 1)" || exit 1
