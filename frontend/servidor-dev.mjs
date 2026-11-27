#!/usr/bin/env node
/**
 * Servidor de desenvolvimento do front-end: serve public/ e repassa /auth, /web e /admin ao gateway.
 * Sem dependências. Use: npm run dev   (variáveis: PORT=5173, GATEWAY_URL=http://localhost:8080)
 *
 * Em produção quem serve os arquivos é o próprio gateway (ver Dockerfile e nginx.conf); este arquivo
 * só existe para trabalhar na interface com o sistema rodando em outra porta.
 */

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLICO = resolve(dirname(fileURLToPath(import.meta.url)), "public");
const PORTA = Number(process.env.PORT ?? 5173);
const GATEWAY = new URL(process.env.GATEWAY_URL ?? "http://localhost:8080");
const PREFIXOS_DA_API = ["/auth/", "/web/", "/admin/"];

// Mesmos cabeçalhos de segurança do nginx (seguranca.inc): quem desenvolve vê violações da CSP na hora.
const CABECALHOS_DE_SEGURANCA = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seguranca.inc"), "utf8")
    .split(/\r?\n/)
    .map((linha) => linha.match(/^add_header\s+(\S+)\s+"(.*)"\s+always;$/))
    .filter(Boolean)
    .map(([, nome, valor]) => [nome, valor])
);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8"
};

function repassar(req, res) {
  const proxy = http.request(
    { hostname: GATEWAY.hostname, port: GATEWAY.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: GATEWAY.host } },
    (resposta) => {
      res.writeHead(resposta.statusCode ?? 502, resposta.headers);
      resposta.pipe(res);
    }
  );
  proxy.on("error", (erro) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ codigo: "GATEWAY_INDISPONIVEL", mensagem: `Gateway em ${GATEWAY.origin} não respondeu: ${erro.message}` }));
  });
  req.pipe(proxy);
}

function servirArquivo(req, res) {
  const caminho = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let arquivo = normalize(join(PUBLICO, caminho === "/" ? "index.html" : caminho));
  // Barra tentativas de sair de public/ (../).
  if (arquivo !== PUBLICO && !arquivo.startsWith(PUBLICO + sep)) {
    res.writeHead(403).end("Acesso negado");
    return;
  }
  if (!existsSync(arquivo) || statSync(arquivo).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Não encontrado");
    return;
  }
  res.writeHead(200, { "Content-Type": TIPOS[extname(arquivo)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...CABECALHOS_DE_SEGURANCA });
  createReadStream(arquivo).pipe(res);
}

http
  .createServer((req, res) => {
    if (PREFIXOS_DA_API.some((p) => req.url.startsWith(p))) repassar(req, res);
    else servirArquivo(req, res);
  })
  .listen(PORTA, () => {
    console.log(`ConectaU (interface) em http://localhost:${PORTA}  ·  gateway: ${GATEWAY.origin}`);
  });
