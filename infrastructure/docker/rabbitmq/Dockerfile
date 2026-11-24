# Broker de eventos do ConectaU (RabbitMQ), com configuração própria.
#   docker build -f infrastructure/docker/rabbitmq/Dockerfile -t conectau/rabbitmq:1.0.0 .
FROM rabbitmq:4.1-management-alpine

LABEL org.opencontainers.image.title="conectau-rabbitmq" \
      org.opencontainers.image.description="RabbitMQ do ConectaU (eventos da outbox)"

COPY infrastructure/docker/rabbitmq/rabbitmq.conf /etc/rabbitmq/conf.d/20-conectau.conf

HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=5 \
  CMD rabbitmq-diagnostics -q ping || exit 1
