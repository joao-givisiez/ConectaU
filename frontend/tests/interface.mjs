#!/usr/bin/env node
/**
 * Verificações estáticas da interface (sem navegador e sem o sistema no ar):
 *   - todo ícone usado no código existe em js/icones.js;
 *   - toda classe usada nos arquivos JS existe no CSS;
 *   - o CSS só usa as cores da âncora (nada de branco, preto ou cinza), cantos de 16 a 32 px e nenhum creme;
 *   - os pares de cor que carregam texto têm contraste mínimo de 4,5:1 (WCAG AA);
 *   - nenhum glifo Unicode é usado como ícone;
 *   - cada rota do roteador aponta para uma página que existe e exporta renderizar().
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONES } from "../public/js/icones.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const lerTexto = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");
const listar = (pasta, extensao) =>
  readdirSync(join(RAIZ, pasta), { recursive: true })
    .filter((f) => f.endsWith(extensao))
    .map((f) => join(pasta, f).replaceAll("\\", "/"));

const arquivosJs = [...listar("js", ".js")].filter((f) => f !== "js/icones.js");
const arquivosCss = listar("estilo", ".css");
const css = arquivosCss.map(lerTexto).join("\n");

let falhas = 0;
function verificar(nome, problemas) {
  if (problemas.length === 0) {
    console.log(`  OK      ${nome}`);
    return;
  }
  falhas += problemas.length;
  console.log(`  FALHOU  ${nome}`);
  for (const p of problemas) console.log(`          - ${p}`);
}

// ---------- sintaxe ----------

{
  // Um erro de sintaxe só apareceria no navegador: confere todos os arquivos antes.
  const problemas = [];
  const raizDoProjeto = resolve(RAIZ, "..");
  const alvos = [...arquivosJs.map((f) => join(RAIZ, f)), join(raizDoProjeto, "servidor-dev.mjs"), ...readdirSync(join(raizDoProjeto, "tests")).filter((f) => f.endsWith(".mjs")).map((f) => join(raizDoProjeto, "tests", f))];
  for (const alvo of alvos) {
    const resultado = spawnSync(process.execPath, ["--check", alvo], { encoding: "utf8" });
    if (resultado.status !== 0) problemas.push(`${alvo.replace(raizDoProjeto, "")}: ${resultado.stderr.split("\n").find((l) => /Error/.test(l)) ?? "erro de sintaxe"}`);
  }
  verificar(`sintaxe válida em ${alvos.length} arquivos JavaScript`, problemas);
}

// ---------- ícones ----------

{
  const problemas = [];
  for (const arquivo of [...arquivosJs, "index.html"]) {
    const texto = lerTexto(arquivo);
    for (const [, nome] of texto.matchAll(/\bicone\(\s*"([\w-]+)"/g)) {
      if (!ICONES[nome]) problemas.push(`${arquivo}: ícone "${nome}" não existe em icones.js`);
    }
    // Ícones escolhidos por nome em tabelas (icone: "bell").
    for (const [, nome] of texto.matchAll(/\bicone:\s*"([\w-]+)"/g)) {
      if (!ICONES[nome]) problemas.push(`${arquivo}: ícone "${nome}" não existe em icones.js`);
    }
  }
  verificar("ícones usados existem em icones.js", problemas);
}

// ---------- classes ----------

{
  const definidas = new Set([...css.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]));
  const problemas = [];
  for (const arquivo of arquivosJs) {
    const texto = lerTexto(arquivo);
    for (const [, valor] of texto.matchAll(/classe:\s*"([^"$]*)"/g)) {
      for (const classe of valor.split(/\s+/).filter(Boolean)) {
        if (!definidas.has(classe)) problemas.push(`${arquivo}: classe "${classe}" não tem regra no CSS`);
      }
    }
  }
  verificar("classes usadas no JS existem no CSS", [...new Set(problemas)]);
}

// ---------- paleta e cantos ----------

const PALETA = new Map(
  Object.entries({
    "#8b9d83": "sálvia",
    "#b08b6e": "barro",
    "#c66b3d": "terracota",
    "#c08e3a": "ocre",
    "#606c38": "musgo",
    "#e8dcc7": "areia",
    "#d4b895": "aveia",
    "#47502a": "musgo-fundo",
    "#9a4720": "terracota-fundo",
    "#7a5410": "ocre-fundo",
    "#4f6149": "sálvia-fundo",
    "#7a5a40": "barro-fundo",
    "#2e2619": "tinta",
    "#5a4a36": "tinta-suave"
  })
);

{
  const problemas = [];
  for (const arquivo of arquivosCss) {
    const texto = lerTexto(arquivo).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, hex] of texto.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      const completo = `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`.toLowerCase();
      if (!PALETA.has(completo)) problemas.push(`${arquivo}: cor ${completo} fora da paleta`);
    }
    for (const [, nome] of texto.matchAll(/:\s*(white|black|gr[ae]y|silver)\b/gi)) {
      problemas.push(`${arquivo}: cor nomeada "${nome}"`);
    }
  }
  const html = lerTexto("index.html");
  for (const [, hex] of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    if (!PALETA.has(`#${hex}`.toLowerCase())) problemas.push(`index.html: cor #${hex} fora da paleta`);
  }
  verificar("só cores da paleta (sem branco, preto nem cinza)", [...new Set(problemas)]);
}

{
  const problemas = [];
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, valor] of semComentarios.matchAll(/border-radius:\s*([^;]+);/g)) {
    for (const px of valor.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      const n = Number(px[1]);
      if (n < 16 || n > 32) problemas.push(`border-radius com ${n}px (permitido: 16 a 32 px)`);
    }
    if (/\b0(?![\d.%])(?!px)/.test(valor.replace(/var\([^)]*\)/g, "")) && !/%/.test(valor)) {
      problemas.push(`border-radius com canto reto: "${valor.trim()}"`);
    }
  }
  // Os tokens --raio-* também precisam respeitar a faixa.
  for (const [, valor] of semComentarios.matchAll(/--raio[\w-]*:\s*([^;]+);/g)) {
    for (const px of valor.matchAll(/(\d+)px/g)) {
      if (Number(px[1]) < 16 || Number(px[1]) > 32) problemas.push(`token de raio com ${px[1]}px`);
    }
  }
  verificar("cantos entre 16 e 32 px, sem canto reto", [...new Set(problemas)]);
}

{
  const problemas = [];
  for (const [, claro] of css.matchAll(/#([ef][0-9a-f]{5})\b/gi)) {
    // Creme é o bege claro #F0 ou mais: areia (#E8DCC7) é o limite permitido da âncora.
    if (parseInt(claro.slice(0, 2), 16) >= 0xf0) problemas.push(`superfície creme #${claro}`);
  }
  verificar("nenhuma superfície creme (#F0 ou mais claro)", problemas);
}

// ---------- contraste ----------

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

{
  // Pares texto/fundo que o CSS realmente usa para texto pequeno.
  const pares = [
    ["tinta sobre areia (texto)", "#2e2619", "#e8dcc7"],
    ["tinta-suave sobre areia (texto secundário)", "#5a4a36", "#e8dcc7"],
    ["tinta sobre aveia (balões, chips)", "#2e2619", "#d4b895"],
    ["areia sobre musgo-fundo (botão, aba, painel)", "#e8dcc7", "#47502a"],
    ["areia sobre terracota-fundo (botão de destaque, selo urgente)", "#e8dcc7", "#9a4720"],
    ["terracota-fundo sobre areia (erros, links)", "#9a4720", "#e8dcc7"],
    ["tinta sobre sálvia (balão do usuário, selo tranquilo)", "#2e2619", "#8b9d83"],
    ["tinta sobre ocre (selos de atenção e de evento)", "#2e2619", "#c08e3a"],
    ["tinta sobre barro (selo de bolsa)", "#2e2619", "#b08b6e"],
    ["areia sobre sálvia-fundo (selo de projeto)", "#e8dcc7", "#4f6149"],
    ["aveia sobre musgo-fundo (texto de apoio nos painéis)", "#d4b895", "#47502a"],
    ["musgo-fundo sobre areia (texto de apoio e links)", "#47502a", "#e8dcc7"]
  ];
  const problemas = [];
  for (const [nome, frente, fundo] of pares) {
    const razao = contraste(frente, fundo);
    if (razao < 4.5) problemas.push(`${nome}: ${razao.toFixed(2)}:1 (mínimo 4,5:1)`);
  }
  verificar(`contraste mínimo de 4,5:1 em ${pares.length} pares de texto`, problemas);
}

// ---------- glifos como ícone ----------

{
  const problemas = [];
  // Setas, formas geométricas, dingbats e símbolos diversos. O ponto médio (·), o travessão e as reticências são pontuação.
  const proibidos = /[←-⇿■-◿☀-➿⬀-⯿\u{1F300}-\u{1FAFF}]/u;
  for (const arquivo of [...arquivosJs, "index.html"]) {
    lerTexto(arquivo)
      .split("\n")
      .forEach((linha, i) => {
        const achado = linha.match(proibidos);
        if (achado) problemas.push(`${arquivo}:${i + 1}: glifo "${achado[0]}"`);
      });
  }
  verificar("nenhum glifo Unicode usado como ícone", problemas);
}

// ---------- compatível com a CSP ----------

{
  const problemas = [];
  const html = lerTexto("index.html");
  if (/\sstyle\s*=/.test(html)) problemas.push("index.html: atributo style inline");
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problemas.push("index.html: <script> inline");
  if (/\son\w+\s*=/.test(html)) problemas.push("index.html: manipulador de evento inline");
  for (const arquivo of arquivosJs) {
    lerTexto(arquivo)
      .split("\n")
      .forEach((linha, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return; // comentário
        if (/\bstyle:\s|setAttribute\(\s*["']style["']/.test(linha)) problemas.push(`${arquivo}:${i + 1}: estilo inline (use style.setProperty ou uma classe)`);
        if (/\beval\(|new Function\(|setTimeout\(\s*["'`]/.test(linha)) problemas.push(`${arquivo}:${i + 1}: execução de texto como código`);
      });
  }
  const inc = readFileSync(join(RAIZ, "../seguranca.inc"), "utf8");
  if (!/Content-Security-Policy/.test(inc) || !/default-src 'none'/.test(inc)) problemas.push("seguranca.inc sem a CSP restritiva");
  verificar("compatível com a CSP (sem estilo, script ou evento inline)", problemas);
}

// ---------- rotas do roteador ----------

{
  const problemas = [];
  const roteador = lerTexto("js/roteador.js");
  for (const [, modulo] of roteador.matchAll(/modulo:\s*"\.\/([^"]+)"/g)) {
    const caminho = `js/${modulo}`;
    if (!existsSync(join(RAIZ, caminho))) {
      problemas.push(`${caminho} não existe`);
      continue;
    }
    if (!/export\s+(async\s+)?function\s+renderizar\b/.test(lerTexto(caminho))) problemas.push(`${caminho} não exporta renderizar()`);
  }
  verificar("cada rota aponta para uma página que exporta renderizar()", problemas);
}

// ---------- conteúdo vindo do servidor nunca vira HTML ----------

{
  const problemas = [];
  for (const arquivo of arquivosJs) {
    lerTexto(arquivo)
      .split("\n")
      .forEach((linha, i) => {
        if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(linha) && arquivo !== "js/ui.js") {
          problemas.push(`${arquivo}:${i + 1}: atribuição de HTML`);
        }
      });
  }
  // Em ui.js, o único innerHTML permitido é o dos ícones (constante do projeto).
  const ui = lerTexto("js/ui.js");
  const usos = ui.match(/\.innerHTML\s*=/g) ?? [];
  if (usos.length !== 1 || !/svg\.innerHTML\s*=\s*miolo/.test(ui)) problemas.push("js/ui.js: innerHTML além do SVG dos ícones");
  verificar("nenhum dado do servidor entra como HTML", problemas);
}

// ---------- cliente da API (com fetch simulado) ----------

{
  const { ErroApi, criarApi, criarCliente } = await import("../public/js/api.js");
  const problemas = [];

  const resposta = (status, corpo, tipo = "application/json") =>
    new Response(status === 204 ? null : corpo, { status, headers: { "Content-Type": tipo } });
  const cliente = (fetchImpl, extras = {}) => criarCliente({ base: "http://gw", fetchImpl, ...extras });
  const tentar = async (promessa) => {
    try {
      await promessa;
      return null;
    } catch (erro) {
      return erro;
    }
  };

  // 429 do Traefik vem em texto puro, não em JSON.
  let erro = await tentar(cliente(async () => resposta(429, "Too Many Requests", "text/plain")).requisitar("GET", "/web/feed"));
  if (!(erro instanceof ErroApi) || erro.status !== 429 || !/Muitas requisições/.test(erro.message)) {
    problemas.push(`429 em texto puro deveria virar mensagem amigável (veio: ${erro?.message})`);
  }

  // Erro do back-end: usa { codigo, mensagem } como veio.
  erro = await tentar(cliente(async () => resposta(409, JSON.stringify({ codigo: "CONFLITO", mensagem: "Já existe" }))).requisitar("POST", "/x", { corpo: {} }));
  if (erro?.codigo !== "CONFLITO" || erro?.message !== "Já existe") problemas.push("erro JSON do back-end não foi repassado");

  // Sem conexão e tempo esgotado.
  erro = await tentar(cliente(async () => { throw new TypeError("fetch failed"); }).requisitar("GET", "/x"));
  if (erro?.codigo !== "SEM_CONEXAO") problemas.push("queda de rede deveria virar SEM_CONEXAO");
  erro = await tentar(
    cliente((_url, { signal }) => new Promise((_ok, falhar) => signal.addEventListener("abort", () => falhar(Object.assign(new Error("abortado"), { name: "AbortError" })))))
      .requisitar("GET", "/x", { timeoutMs: 20 })
  );
  if (erro?.codigo !== "TEMPO_ESGOTADO") problemas.push("timeout deveria virar TEMPO_ESGOTADO");

  // 401 de quem tinha token avisa a interface; sem token (login errado) não avisa.
  let avisos = 0;
  const comToken = cliente(async () => resposta(401, JSON.stringify({ codigo: "NAO_AUTENTICADO", mensagem: "x" })), { obterToken: () => "t", aoNaoAutenticado: () => (avisos += 1) });
  await tentar(comToken.requisitar("GET", "/web/perfil"));
  const semToken = cliente(async () => resposta(401, JSON.stringify({ codigo: "NAO_AUTENTICADO", mensagem: "x" })), { aoNaoAutenticado: () => (avisos += 1) });
  await tentar(semToken.requisitar("POST", "/auth/sessoes", { corpo: {} }));
  if (avisos !== 1) problemas.push(`aoNaoAutenticado deveria disparar 1 vez (disparou ${avisos})`);

  // Cabeçalhos, corpo e consulta; login nunca envia o token.
  let visto;
  const api = criarApi(cliente(async (url, opcoes) => { visto = { url, ...opcoes }; return resposta(204, ""); }, { obterToken: () => "abc" }));
  await api.web.oportunidades({ busca: "docker", campus: "", categoria: undefined, pagina: 2 });
  if (visto.url !== "http://gw/web/oportunidades?busca=docker&pagina=2") problemas.push(`consulta montada errada: ${visto.url}`);
  if (visto.headers.Authorization !== "Bearer abc") problemas.push("token não foi enviado");
  await api.auth.entrar({ email: "a@b.c", senha: "12345678" });
  if (visto.headers.Authorization) problemas.push("o login não deveria enviar Authorization");
  await api.web.criarLembrete("id-1", 48);
  if (visto.method !== "POST" || visto.body !== JSON.stringify({ oportunidadeId: "id-1", antecedenciaHoras: 48 })) problemas.push("corpo do lembrete errado");

  verificar("cliente da API: erros, tempo esgotado, 401, consulta e cabeçalhos", problemas);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} problema(s).`);
process.exit(falhas === 0 ? 0 : 1);
