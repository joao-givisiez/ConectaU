# Cliente portal-web do ConectaU: arquivos estáticos servidos por nginx sem privilégios de root.
#   docker build -t conectau/portal-web:1.0.0 clients/portal-web
#
# Sem multi-stage: o cliente é HTML, CSS e JavaScript puros, sem etapa de compilação.
# Um estágio de build só faria sentido se houvesse empacotamento (ex.: Vite).
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="conectau-portal-web"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
