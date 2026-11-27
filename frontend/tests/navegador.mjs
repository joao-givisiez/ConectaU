#!/usr/bin/env node
/**
 * Roteiro de navegador (ponta a ponta): abre a interface de verdade e percorre o que uma pessoa faria.
 * Cadastro pela tela, busca, detalhe, salvar, lembrete, assistente (com fontes, recusa e markdown),
 * perfil, curadoria do administrador e o celular. Falha se houver erro de console, requisição quebrada,
 * violação da CSP, rolagem horizontal ou valores como "null"/"undefined" escritos na tela.
 *
 * Pré-requisitos: o sistema no ar (docker compose up -d) e o pacote playwright-core, que NÃO é dependência do projeto:
 *     cd frontend && npm i --no-save playwright-core
 *
 *   node tests/navegador.mjs            usa http://localhost:8080/app (a interface atrás do gateway)
 *   BASE=http://localhost:5173 node tests/navegador.mjs     contra o servidor de desenvolvimento (npm run dev)
 *   node tests/navegador.mjs --llm      inclui UMA pergunta real ao agente (consome o modelo da Groq)
 *
 * Variáveis: BASE, NAVEGADOR (caminho do Edge/Chrome/Chromium), ADMIN_EMAIL e ADMIN_SENHA (ou o .env da raiz).
 * As capturas de tela ficam em tests/capturas/ (fora do Git). A conta de estudante criada tem e-mail único.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:8080/app";
const FOTOS = `${resolve(AQUI, "capturas")}/`;
mkdirSync(FOTOS, { recursive: true });
const LLM_REAL = process.argv.includes("--llm");

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error('Falta o playwright-core. Instale sem alterar o package.json: "cd frontend && npm i --no-save playwright-core".');
  process.exit(2);
}

function lerEnvDaRaiz() {
  try {
    return Object.fromEntries(
      readFileSync(resolve(AQUI, "../../.env"), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    return {};
  }
}
const arquivoEnv = lerEnvDaRaiz();
const env = { ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? arquivoEnv.ADMIN_EMAIL, ADMIN_SENHA: process.env.ADMIN_SENHA ?? arquivoEnv.ADMIN_SENHA };
if (!env.ADMIN_EMAIL || !env.ADMIN_SENHA) {
  console.error("Sem ADMIN_EMAIL/ADMIN_SENHA no ambiente nem no .env da raiz: a etapa da curadoria não tem como entrar.");
  process.exit(2);
}

const CANDIDATOS_DE_NAVEGADOR = [
  process.env.NAVEGADOR,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const caminhoDoNavegador = CANDIDATOS_DE_NAVEGADOR.find((caminho) => existsSync(caminho));
if (!caminhoDoNavegador) {
  console.error("Não achei Edge, Chrome ou Chromium. Informe o caminho em NAVEGADOR=...");
  process.exit(2);
}

const navegador = await chromium.launch({ executablePath: caminhoDoNavegador, headless: true });
const problemas = [];
const sufixo = Date.now().toString(36);

async function novaPagina(largura, altura, nome) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const pagina = await contexto.newPage();
  pagina.on("console", (m) => { if (m.type() === "error") problemas.push(`[${nome}] console: ${m.text()}`); });
  pagina.on("pageerror", (e) => problemas.push(`[${nome}] erro de página: ${e.message}`));
  pagina.on("requestfailed", (r) => problemas.push(`[${nome}] requisição falhou: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  return pagina;
}

async function foto(pagina, nome, cheia = true) {
  await pagina.waitForTimeout(500);
  // Lixo de renderização: valores nulos/indefinidos que viraram texto na tela.
  const lixo = await pagina.evaluate(() => {
    const texto = document.body.innerText;
    const palavras = texto.split(/\s+/);
    const achados = [];
    if (palavras.includes("null")) achados.push("null");
    if (palavras.includes("undefined")) achados.push("undefined");
    if (palavras.includes("NaN")) achados.push("NaN");
    if (texto.includes("[object Object]")) achados.push("[object Object]");
    if (texto.includes("Invalid Date")) achados.push("Invalid Date");
    return achados;
  });
  if (lixo.length) problemas.push(`[${nome}] texto indevido na tela: ${lixo.join(", ")}`);
  if (cheia) {
    // Elementos fixos (topo, campo de pergunta) distorcem fullPage: estica a janela até o fim do documento.
    const original = pagina.viewportSize();
    const altura = await pagina.evaluate(() => document.documentElement.scrollHeight);
    await pagina.setViewportSize({ width: original.width, height: Math.min(Math.max(altura, original.height), 4000) });
    await pagina.waitForTimeout(250);
    await pagina.screenshot({ path: `${FOTOS}${nome}.png` });
    await pagina.setViewportSize(original);
  } else {
    await pagina.screenshot({ path: `${FOTOS}${nome}.png` });
  }
}

async function semRolagemHorizontal(pagina, rotulo) {
  const { rolagem, janela } = await pagina.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: window.innerWidth }));
  if (rolagem > janela + 1) problemas.push(`[${rotulo}] rolagem horizontal: conteúdo com ${rolagem}px numa janela de ${janela}px`);
}

async function etapa(nome, fn) {
  try { await fn(); console.log(`  OK      ${nome}`); }
  catch (erro) { problemas.push(`${nome}: ${erro.message.split("\n")[0]}`); console.log(`  FALHOU  ${nome}\n          ${erro.message.split("\n")[0]}`); }
}

// ---------------- desktop, anônimo ----------------
const d = await novaPagina(1280, 900, "desktop");
await etapa("feed anônimo (desktop)", async () => {
  await d.goto(`${BASE}/`);
  await d.getByRole("heading", { level: 1 }).waitFor();
  await d.locator(".cartao--oportunidade").first().waitFor();
  await foto(d, "01-feed-desktop");
});
await etapa("busca e filtros", async () => {
  await d.getByLabel("Buscar").fill("docker");
  await d.getByRole("button", { name: "Buscar" }).click();
  await d.waitForURL(/busca=docker/);
  await d.locator(".resultado__total").waitFor();
  const total = await d.locator(".cartao--oportunidade").count();
  if (total < 1) throw new Error("a busca por docker não devolveu cartões");
  await d.getByRole("link", { name: "Limpar filtros" }).click();
});
await etapa("detalhe da oportunidade (anônimo)", async () => {
  await d.locator(".cartao__link").first().click();
  await d.locator(".detalhe__titulo").waitFor();
  if (await d.getByRole("link", { name: /Entrar para salvar/ }).count() === 0) throw new Error("faltou o convite para entrar");
  await foto(d, "02-detalhe-anonimo");
});
await etapa("assistente exige login (redireciona)", async () => {
  await d.goto(`${BASE}/#/assistente`);
  await d.waitForURL(/#\/entrar\?volta=/);
});

// ---------------- cadastro pela interface ----------------
const email = `e2e.${sufixo}@exemplo.com`;
await etapa("cadastro pela interface + login automático", async () => {
  const f = d.locator('form[aria-labelledby="titulo-cadastro"]');
  await foto(d, "03-entrar");
  await f.getByLabel("Nome").fill("Marina Teste");
  await f.getByLabel("E-mail").fill(email);
  await f.getByLabel("Senha").fill("senha-de-teste-123");
  await f.getByLabel("Curso").fill("Ciência da Computação");
  await f.getByLabel("Campus").selectOption("LAVRAS");
  await f.getByLabel("Interesses").fill("tecnologia, pesquisa");
  await f.getByRole("button", { name: "Criar conta" }).click();
  await d.waitForURL(/#\/assistente/); // volta para onde queria ir
  await d.getByRole("heading", { level: 1, name: /Assistente do/ }).waitFor();
});

await etapa("assistente: tela inicial", async () => {
  await foto(d, "04-assistente-vazio");
  await semRolagemHorizontal(d, "assistente-desktop");
});

// força o modo de recuperação (sem Groq) nas perguntas desta etapa, para ver as fontes na interface
await d.route("**/web/conversas/*/mensagens", async (rota) => {
  const corpo = JSON.parse(rota.request().postData() ?? "{}");
  await rota.continue({ postData: JSON.stringify({ ...corpo, modo: "recuperacao" }) });
});
await etapa("assistente: pergunta com fontes (modo recuperação, sem Groq)", async () => {
  await d.getByRole("button", { name: /antecedência o lembrete/ }).click();
  await d.locator(".mensagem--assistente:not(.mensagem--pensando)").waitFor({ timeout: 45000 });
  const texto = await d.locator(".mensagem--assistente").first().innerText();
  if (!/48/.test(texto)) throw new Error("a resposta não menciona as 48 horas");
  await foto(d, "05-assistente-fontes");
  // clicar na citação abre e destaca a fonte
  const citacao = d.locator(".citacao").first();
  if (await citacao.count()) { await citacao.click(); await d.waitForTimeout(500); await foto(d, "06-assistente-citacao", false); }
});
await d.unroute("**/web/conversas/*/mensagens");

await etapa("assistente: pergunta fora do escopo é recusada", async () => {
  await d.getByLabel("Sua pergunta").fill("Qual a melhor receita de bolo de chocolate?");
  await d.getByRole("button", { name: "Enviar" }).click();
  await d.locator('.mensagem--assistente[data-origem="RECUSA"]').waitFor({ timeout: 30000 });
  await foto(d, "07-assistente-recusa");
});
await etapa("assistente: conversa sobrevive ao recarregamento", async () => {
  await d.reload();
  await d.locator(".mensagem--assistente").first().waitFor();
  const n = await d.locator(".mensagem--assistente").count();
  if (n < 2) throw new Error(`esperava 2 respostas restauradas, veio ${n}`);
});

await etapa("respostas do modelo: markdown simples e nenhum HTML executado", async () => {
  await d.getByRole("button", { name: "Nova conversa" }).click();
  const agora = new Date().toISOString();
  const corpo = {
    id: "00000000-0000-4000-8000-0000000000aa", conversaId: "00000000-0000-4000-8000-0000000000bb", pergunta: "x",
    resposta: "Bolsas abertas:\n\n1. **Edital A**\n   - Prazo: 11/12 [F1]\n   - Início: 16/12\n2. **Edital B**\n- Prazo: 12/12 [F2]\n\n*Obs.: confira o canal oficial.*\n\n<img src=x onerror=\"window.__xss=1\"> <script>window.__xss=2</script> [F9]",
    fontes: [
      { id: "F1", tipo: "CATALOGO", titulo: "Edital A", trecho: "trecho a", citada: true },
      { id: "F2", tipo: "OPORTUNIDADE", titulo: "Edital B", trecho: "trecho b", citada: true, fonteUrl: "https://exemplo.com/b" }
    ],
    degradada: false, origem: "LLM", modo: "agente", modelo: "modelo-de-teste", latenciaMs: 12, tokens: { entrada: 1, saida: 2 },
    custoEstimadoUsd: 0, ferramentas: [{ nome: "buscar_oportunidades", duracaoMs: 3 }], escopo: { dentro: true, motivo: "PROXIMA_DA_BASE" }, criadaEm: agora
  };
  await d.route("**/web/conversas/*/mensagens", (rota) => rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(corpo) }));
  await d.getByLabel("Sua pergunta").fill("pergunta simulada");
  await d.getByRole("button", { name: "Enviar" }).click();
  const resposta = d.locator('.mensagem--assistente[data-origem="LLM"]');
  await resposta.waitFor();
  await d.unroute("**/web/conversas/*/mensagens");

  const medidas = await resposta.evaluate((el) => ({
    itensNumerados: el.querySelectorAll(":scope .mensagem__texto > ol > li").length,
    subitensDoPrimeiro: el.querySelectorAll(":scope .mensagem__texto > ol > li:nth-child(1) > ul > li").length,
    subitensDoSegundo: el.querySelectorAll(":scope .mensagem__texto > ol > li:nth-child(2) > ul > li").length,
    italico: el.querySelector(".mensagem__texto em")?.textContent,
    negritos: [...el.querySelectorAll(".mensagem__texto strong")].map((s) => s.textContent),
    citacoes: [...el.querySelectorAll("button.citacao")].map((b) => b.textContent),
    textoCru: el.innerText.includes('<img src=x onerror="window.__xss=1">') && el.innerText.includes("[F9]"),
    imagens: el.querySelectorAll("img").length, scripts: el.querySelectorAll("script").length,
    ferramentas: el.querySelector(".mensagem__meta")?.innerText
  }));
  const xss = await d.evaluate(() => window.__xss);
  const erros = [];
  if (medidas.itensNumerados !== 2) erros.push(`itens numerados: ${medidas.itensNumerados} (esperava 2, numeração contínua)`);
  if (medidas.subitensDoPrimeiro !== 2) erros.push(`sub-itens do 1º: ${medidas.subitensDoPrimeiro} (esperava 2, recuados)`);
  if (medidas.subitensDoSegundo !== 1) erros.push(`sub-itens do 2º: ${medidas.subitensDoSegundo} (esperava 1, "-" logo abaixo do número)`);
  if (!/Obs\.: confira/.test(medidas.italico ?? "")) erros.push(`itálico não renderizado: ${medidas.italico}`);
  if (medidas.negritos.join("|") !== "Edital A|Edital B") erros.push(`negritos: ${medidas.negritos}`);
  if (medidas.citacoes.join(",") !== "F1,F2") erros.push(`citações clicáveis: ${medidas.citacoes} (F9 não existe e não pode virar botão)`);
  if (!medidas.textoCru) erros.push("a carga HTML não apareceu como texto literal");
  if (medidas.imagens || medidas.scripts) erros.push("HTML da resposta virou elemento");
  if (xss !== undefined) erros.push(`SCRIPT EXECUTOU (window.__xss = ${xss})`);
  if (!/Catálogo de oportunidades/.test(medidas.ferramentas ?? "")) erros.push(`ferramenta consultada não aparece: ${medidas.ferramentas}`);
  if (erros.length) throw new Error(erros.join("; "));
  await foto(d, "08b-assistente-markdown");
});

if (LLM_REAL) {
  await etapa("assistente: UMA pergunta real ao agente (Groq)", async () => {
    await d.getByRole("button", { name: "Nova conversa" }).click();
    await d.getByLabel("Sua pergunta").fill("Quais bolsas estão abertas no campus de Lavras e quando fecham?");
    await d.getByRole("button", { name: "Enviar" }).click();
    await d.locator(".mensagem--assistente:not(.mensagem--pensando)").waitFor({ timeout: 70000 });
    const origem = await d.locator(".mensagem--assistente").first().getAttribute("data-origem");
    console.log(`          origem=${origem}`);
    await foto(d, "08-assistente-agente-real");
  });
}

await etapa("feed personalizado", async () => {
  await d.goto(`${BASE}/#/`);
  await d.getByRole("heading", { level: 1, name: /Para você/ }).waitFor();
  await d.locator(".cartao--oportunidade").first().waitFor();
  await foto(d, "09-feed-personalizado");
});

await etapa("detalhe: salvar, lembrar e agente do edital", async () => {
  await d.locator(".cartao__link").first().click();
  await d.locator(".detalhe__titulo").waitFor();
  await d.getByRole("button", { name: "Salvar", exact: true }).click();
  await d.getByRole("button", { name: "Remover dos salvos" }).waitFor();
  await d.getByRole("button", { name: "Lembrar do prazo" }).click();
  await d.getByRole("button", { name: "Criar lembrete" }).click();
  await d.locator(".aviso").filter({ hasText: "Lembrete criado" }).waitFor();
  await d.locator(".assistente-edital").waitFor();
  await foto(d, "10-detalhe-logado");
});

await etapa("salvos e lembretes", async () => {
  await d.goto(`${BASE}/#/salvos`);
  await d.getByRole("heading", { name: "Oportunidades salvas" }).waitFor();
  await d.locator(".item").first().waitFor();
  await foto(d, "11-salvos");
  await d.getByRole("button", { name: /Excluir o lembrete/ }).first().click();
  await d.locator(".aviso").filter({ hasText: "Lembrete excluído" }).waitFor();
  await d.getByRole("button", { name: /dos salvos/ }).first().click();
  await d.locator(".aviso").filter({ hasText: "Removida dos salvos" }).waitFor();
});
await etapa("avisos", async () => {
  await d.goto(`${BASE}/#/avisos`);
  await d.getByRole("heading", { level: 1, name: /avisos/ }).waitFor();
  await foto(d, "12-avisos");
});
await etapa("perfil: editar e salvar", async () => {
  await d.goto(`${BASE}/#/perfil`);
  await d.getByLabel("Curso").waitFor();
  await d.getByLabel("Curso").fill("Sistemas de Informação");
  await d.getByRole("button", { name: "Salvar alterações" }).click();
  await d.locator(".aviso").filter({ hasText: "Perfil atualizado" }).waitFor();
  await foto(d, "13-perfil");
});
await etapa("curadoria é negada a estudante", async () => {
  await d.goto(`${BASE}/#/curadoria`);
  await d.getByText("A curadoria é exclusiva de administradores.").waitFor();
});
await etapa("sair", async () => {
  await d.getByRole("button", { name: "Sair" }).click();
  await d.getByRole("link", { name: "Entrar" }).first().waitFor();
});

// ---------------- administrador ----------------
const a = await novaPagina(1280, 900, "admin");
await etapa("login do administrador e curadoria", async () => {
  await a.goto(`${BASE}/#/entrar`);
  const f = a.locator('form[aria-labelledby="titulo-entrar"]');
  await f.getByLabel("E-mail").fill(env.ADMIN_EMAIL);
  await f.getByLabel("Senha").fill(env.ADMIN_SENHA);
  await f.getByRole("button", { name: "Entrar" }).click();
  await a.waitForURL(/#\/curadoria/);
  await a.getByRole("heading", { level: 2, name: "Fila de curadoria" }).waitFor();
  await foto(a, "14-curadoria-fila");
});
await etapa("curadoria: publicadas + registro completo", async () => {
  await a.getByRole("link", { name: "Publicadas" }).click();
  await a.getByRole("button", { name: "Ver registro completo" }).first().click();
  await a.locator(".registro").waitFor();
  await foto(a, "15-curadoria-publicadas");
});
await etapa("curadoria: fontes e coletas", async () => {
  await a.getByRole("link", { name: "Fontes" }).click();
  await a.getByRole("heading", { name: "Nova fonte" }).waitFor();
  await foto(a, "16-curadoria-fontes");
});

// ---------------- celular ----------------
const m = await novaPagina(390, 844, "celular");
await etapa("celular: feed, detalhe e navegação inferior", async () => {
  await m.goto(`${BASE}/`);
  await m.locator(".cartao--oportunidade").first().waitFor();
  await foto(m, "20-feed-celular", false);
  await semRolagemHorizontal(m, "feed-celular");
  await m.locator(".cartao__link").first().click();
  await m.locator(".detalhe__titulo").waitFor();
  await semRolagemHorizontal(m, "detalhe-celular");
  await foto(m, "21-detalhe-celular", false);
});
await etapa("celular: assistente logado", async () => {
  await m.goto(`${BASE}/#/entrar`);
  const f = m.locator('form[aria-labelledby="titulo-entrar"]');
  await f.getByLabel("E-mail").fill(email);
  await f.getByLabel("Senha").fill("senha-de-teste-123");
  await f.getByRole("button", { name: "Entrar" }).click();
  await m.waitForURL(/#\/$/);
  await m.goto(`${BASE}/#/assistente`);
  await m.getByRole("heading", { level: 1, name: /Assistente do/ }).waitFor();
  await semRolagemHorizontal(m, "assistente-celular");
  await foto(m, "22-assistente-celular", false);
});

await navegador.close();
console.log(`\n${problemas.length === 0 ? "Nenhum problema encontrado." : `${problemas.length} problema(s):\n- ${[...new Set(problemas)].join("\n- ")}`}`);
console.log(`Imagens em ${FOTOS}`);
process.exit(problemas.length === 0 ? 0 : 1);
