# Front-end do ConectaU: arquivos estáticos servidos por nginx sem privilégios de root.
#   docker build -t conectau/frontend:1.0.0 frontend
#
# Sem multi-stage: a interface é HTML, CSS e JavaScript puros, sem etapa de compilação
# (as fontes e os ícones já estão em public/). Um estágio de build só faria sentido com empacotamento.
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="conectau-frontend"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY seguranca.inc /etc/nginx/seguranca.inc
COPY public/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
