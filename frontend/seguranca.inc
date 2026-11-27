# Cabeçalhos de segurança da interface. Incluído em cada location do nginx.conf, porque add_header de um
# location substitui (não soma) os do nível acima.
#
# CSP: só recursos do próprio domínio. Sem script, estilo ou evento inline; img-src aceita data: por causa
# do grão de papel (SVG embutido no CSS). A interface só fala com /auth, /web e /admin, na mesma origem.
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
