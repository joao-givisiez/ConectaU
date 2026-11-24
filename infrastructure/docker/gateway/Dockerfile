# API Gateway do ConectaU (Traefik) com as regras de roteamento e os middlewares embutidos.
# Usado no Docker Compose; no Kubernetes, o mesmo papel é feito pelo Traefik do cluster
# (Ingress + Middlewares do Traefik em infrastructure/kubernetes/gateway.yaml).
#   docker build -f infrastructure/docker/gateway/Dockerfile -t conectau/gateway:1.0.0 .
FROM traefik:v3.7

LABEL org.opencontainers.image.title="conectau-gateway" \
      org.opencontainers.image.description="API Gateway do ConectaU (Traefik)"

COPY infrastructure/docker/gateway/traefik.yml /etc/traefik/traefik.yml
COPY infrastructure/docker/gateway/dinamico.yml /etc/traefik/dinamico.yml

EXPOSE 8000 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD traefik healthcheck --ping || exit 1
