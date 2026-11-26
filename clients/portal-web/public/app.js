// Portal Web do ConectaU (comunidade). Fala só com o gateway: /auth/** e /web/**.
// Os botões de ação de cada oportunidade vêm dos links HATEOAS da resposta (_links).
"use strict";

const estado = {
  token: lerSessao("token"),
  papel: lerSessao("papel")
};

const $ = (seletor) => document.querySelector(seletor);
const conteudo = $("#conteudo");

function lerSessao(chave) {
  try { return sessionStorage.getItem(`conectau.${chave}`); } catch { return null; }
}
function gravarSessao(chave, valor) {
  try {
    if (valor === null) sessionStorage.removeItem(`conectau.${chave}`);
    else sessionStorage.setItem(`conectau.${chave}`, valor);
  } catch { /* sem armazenamento: a sessão dura só até recarregar */ }
}

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function avisar(mensagem, erro = false) {
  const aviso = $("#aviso");
  aviso.textContent = mensagem;
  aviso.className = `aviso${erro ? " erro" : ""}`;
  clearTimeout(avisar.temporizador);
  avisar.temporizador = setTimeout(() => aviso.classList.add("oculto"), 5000);
}

async function api(metodo, caminho, corpo) {
  const cabecalhos = { Accept: "application/json" };
  if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  if (estado.token) cabecalhos.Authorization = `Bearer ${estado.token}`;
  const resposta = await fetch(caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  if (resposta.status === 401 && estado.token) sair(false);
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : undefined;
  if (!resposta.ok) throw new Error(dados?.mensagem ?? `Erro ${resposta.status}`);
  return dados;
}

const CATEGORIAS = { EVENTO: "Evento", ATIVIDADE: "Atividade", BOLSA: "Bolsa", PROJETO: "Projeto", PROCESSO_SELETIVO: "Processo seletivo" };
const CAMPI = { LAVRAS: "Lavras", SAO_SEBASTIAO_DO_PARAISO: "São Sebastião do Paraíso" };

function prazoTexto(dias) {
  if (dias === 0) return "prazo termina hoje";
  return dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
}

// ---------- Menu e sessão ----------

function desenharMenu() {
  const menu = $("#menu");
  if (estado.token) {
    menu.innerHTML = `
      <button class="secundario" data-acao="assistente">Assistente</button>
      <button class="secundario" data-acao="favoritos">Salvos</button>
      <button class="secundario" data-acao="avisos">Avisos</button>
      <button class="secundario" data-acao="sair">Sair</button>`;
  } else {
    menu.innerHTML = `<button data-acao="entrar">Entrar</button>`;
  }
}

function sair(avisarUsuario = true) {
  estado.token = null;
  estado.papel = null;
  gravarSessao("token", null);
  gravarSessao("papel", null);
  desenharMenu();
  if (avisarUsuario) avisar("Sessão encerrada.");
  carregarFeed();
}

$("#form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const dados = Object.fromEntries(new FormData(evento.target));
  try {
    const sessao = await api("POST", "/auth/sessoes", dados);
    estado.token = sessao.token;
    estado.papel = sessao.papel;
    gravarSessao("token", sessao.token);
    gravarSessao("papel", sessao.papel);
    $("#sessao").classList.add("oculto");
    desenharMenu();
    avisar("Bem-vindo(a)!");
    carregarFeed();
  } catch (erro) {
    avisar(erro.message, true);
  }
});

$("#form-cadastro").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const dados = Object.fromEntries(new FormData(evento.target));
  dados.interesses = dados.interesses.split(",").map((i) => i.trim()).filter(Boolean);
  try {
    await api("POST", "/auth/usuarios", dados);
    avisar("Conta criada. Agora é só entrar.");
    evento.target.closest("details").open = false;
  } catch (erro) {
    avisar(erro.message, true);
  }
});

$("#form-busca").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const busca = new FormData(evento.target).get("busca").trim();
  if (busca) carregarBusca(busca);
  else carregarFeed();
});

// ---------- Telas ----------

function desenharCards(titulo, lista, vazio) {
  if (lista.itens.length === 0) {
    conteudo.innerHTML = `<h2>${esc(titulo)}</h2><p class="cartao">${esc(vazio)}</p>`;
    return;
  }
  conteudo.innerHTML = `<h2>${esc(titulo)}</h2>` + lista.itens.map((o) => `
    <article class="cartao clicavel" data-oportunidade="${esc(o.id)}">
      <h3>${esc(o.titulo)}</h3>
      <div class="meta">
        <span class="etiqueta">${esc(CATEGORIAS[o.categoria] ?? o.categoria)}</span>
        <span>${esc(CAMPI[o.campus] ?? o.campus)}</span>
        ${o.quando ? `<span>${esc(new Date(o.quando + "T12:00:00").toLocaleDateString("pt-BR"))}</span>` : ""}
        <span>${esc(prazoTexto(o.prazoEmDias))}</span>
        ${o.salvo ? "<span>★ salvo</span>" : ""}
      </div>
    </article>`).join("");
}

async function carregarFeed() {
  try {
    const feed = await api("GET", "/web/feed");
    const filtro = feed.filtro?.campus ? ` — ${CAMPI[feed.filtro.campus]}` : "";
    desenharCards(`Para você${filtro}`, feed, "Nenhuma oportunidade publicada ainda.");
  } catch (erro) {
    avisar(erro.message, true);
  }
}

async function carregarBusca(busca) {
  try {
    const lista = await api("GET", `/web/oportunidades?busca=${encodeURIComponent(busca)}`);
    desenharCards(`Resultados para “${busca}”`, lista, "Nada encontrado.");
  } catch (erro) {
    avisar(erro.message, true);
  }
}

async function carregarDetalhe(id) {
  try {
    const o = await api("GET", `/web/oportunidades/${id}`);
    const links = o._links ?? {};
    // HATEOAS: cada botão só aparece se o link correspondente veio na resposta.
    const acoes = [];
    if (links.salvar && !o.salvo) acoes.push(`<button data-acao="salvar" data-id="${esc(o.id)}">Salvar</button>`);
    if (o.salvo && o.favoritoId) acoes.push(`<button class="secundario" data-acao="dessalvar" data-id="${esc(o.favoritoId)}">Remover dos salvos</button>`);
    if (links.lembrar) acoes.push(`<button class="secundario" data-acao="lembrar" data-id="${esc(o.id)}">Lembrar do prazo</button>`);
    if (links.fonteOficial) acoes.push(`<a class="botao secundario" href="${esc(links.fonteOficial.href)}" target="_blank" rel="noopener">Inscrever-se no canal oficial</a>`);
    if (!estado.token) acoes.push(`<button class="secundario" data-acao="entrar">Entre para salvar e perguntar</button>`);

    conteudo.innerHTML = `
      <article class="cartao">
        <h2>${esc(o.titulo)}</h2>
        <div class="meta">
          <span class="etiqueta">${esc(CATEGORIAS[o.categoria] ?? o.categoria)}</span>
          <span>${esc(CAMPI[o.campus] ?? o.campus)}</span>
          <span>Inscrições até ${esc(new Date(o.prazoInscricao).toLocaleString("pt-BR"))}</span>
          <span>${esc(prazoTexto(o.prazoEmDias))}</span>
        </div>
        <p>${esc(o.descricao ?? "")}</p>
        ${o.tags?.length ? `<p class="meta">${o.tags.map((t) => `<span class="etiqueta">${esc(t)}</span>`).join("")}</p>` : ""}
        <div class="acoes">${acoes.join("")}</div>
      </article>
      ${links.perguntar ? `
      <section class="cartao">
        <h3>Perguntar ao assistente sobre este edital</h3>
        <div id="resposta"></div>
        <form id="form-pergunta" class="busca">
          <input name="pergunta" required maxlength="2000" placeholder="Ex.: quais são os requisitos?">
          <button type="submit">Perguntar</button>
        </form>
      </section>` : ""}`;

    const formPergunta = $("#form-pergunta");
    if (formPergunta) {
      let conversaId;
      formPergunta.addEventListener("submit", (evento) => {
        evento.preventDefault();
        perguntarAoAssistente(formPergunta, $("#resposta"), async () => {
          conversaId ??= (await api("POST", links.perguntar.href, { oportunidadeId: o.id })).id;
          return conversaId;
        });
      });
    }
  } catch (erro) {
    avisar(erro.message, true);
  }
}

// ---------- Assistente ----------

const ORIGEM_DA_RESPOSTA = {
  LLM: (m) => `Resposta gerada por IA (${m.modelo ?? "modelo de linguagem"}) a partir das fontes abaixo`,
  CACHE: () => "Resposta reaproveitada de uma pergunta igual ou parecida (cache)",
  FALLBACK: () => "Modo degradado: o modelo de linguagem está indisponível, então mostro só os trechos encontrados",
  RECUSA: () => "Fora do escopo do ConectaU"
};
const TIPO_DA_FONTE = { CONHECIMENTO: "Base de conhecimento", OPORTUNIDADE: "Edital", CATALOGO: "Catálogo" };

/** Resposta do assistente: texto com os rótulos [F#] destacados, origem da resposta e fontes citadas. */
function respostaDoAssistente(m) {
  const texto = esc(m.resposta)
    .split(/\n{2,}/)
    .map((paragrafo) => `<p>${paragrafo.replace(/\n/g, "<br>").replace(/\[(F\d+)\]/g, '<sup class="rotulo">$1</sup>')}</p>`)
    .join("");
  const citadas = m.fontes.filter((f) => f.citada);
  const fontes = citadas.length > 0 ? citadas : m.fontes;
  const listaDeFontes = fontes.length === 0 ? "" : `
    <details ${m.origem === "FALLBACK" ? "open" : ""}>
      <summary>Fontes (${fontes.length})</summary>
      ${fontes.map((f) => `
        <div class="citacao fonte${f.oportunidadeId ? " clicavel" : ""}" ${f.oportunidadeId ? `data-oportunidade="${esc(f.oportunidadeId)}"` : ""}>
          <div class="meta"><span class="rotulo">${esc(f.id)}</span><span class="etiqueta">${TIPO_DA_FONTE[f.tipo] ?? esc(f.tipo)}</span><strong>${esc(f.titulo)}</strong></div>
          <div>${esc(f.trecho)}</div>
          ${f.fonteUrl ? `<a href="${esc(f.fonteUrl)}" target="_blank" rel="noopener">Fonte oficial</a>` : ""}
        </div>`).join("")}
    </details>`;
  const selo = (ORIGEM_DA_RESPOSTA[m.origem] ?? (() => ""))(m);
  return `
    <div class="resposta-assistente origem-${esc(m.origem.toLowerCase())}">
      <div class="selo">${esc(selo)}</div>
      ${texto}
      ${listaDeFontes}
      <div class="meta"><span>${m.latenciaMs} ms</span>${m.tokens?.entrada ? `<span>${m.tokens.entrada + m.tokens.saida} tokens</span>` : ""}</div>
    </div>`;
}

/** Envia a pergunta e mostra a troca na conversa (a conversa é criada na primeira pergunta). */
async function perguntarAoAssistente(form, destino, abrirConversa) {
  const campo = form.querySelector("[name=pergunta]");
  const pergunta = campo.value.trim();
  if (!pergunta) return;
  const botao = form.querySelector("button");
  botao.disabled = true;
  destino.insertAdjacentHTML("beforeend", `<div class="pergunta-usuario">${esc(pergunta)}</div><div class="resposta-assistente carregando">Pensando…</div>`);
  try {
    const conversaId = await abrirConversa();
    const mensagem = await api("POST", `/web/conversas/${conversaId}/mensagens`, { pergunta });
    destino.querySelector(".carregando").outerHTML = respostaDoAssistente(mensagem);
    campo.value = "";
  } catch (erro) {
    destino.querySelector(".carregando")?.remove();
    avisar(erro.message, true);
  } finally {
    botao.disabled = false;
  }
}

async function carregarAssistente() {
  let conversaId;
  conteudo.innerHTML = `
    <section class="cartao">
      <h2>Assistente do ConectaU</h2>
      <p class="meta">Pergunte sobre oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos) e sobre como o ConectaU funciona. As respostas citam as fontes; confira sempre o canal oficial.</p>
      <div id="conversa"></div>
      <form id="form-assistente" class="busca">
        <input name="pergunta" required maxlength="2000" placeholder="Ex.: quais bolsas estão abertas em Lavras e quando fecham?">
        <button type="submit">Perguntar</button>
      </form>
    </section>`;
  $("#form-assistente").addEventListener("submit", (evento) => {
    evento.preventDefault();
    perguntarAoAssistente(evento.target, $("#conversa"), async () => {
      conversaId ??= (await api("POST", "/web/conversas", {})).id;
      return conversaId;
    });
  });
}

async function carregarFavoritos() {
  try {
    const lista = await api("GET", "/web/favoritos?limite=50");
    conteudo.innerHTML = "<h2>Salvos</h2>" + (lista.itens.length === 0
      ? '<p class="cartao">Você ainda não salvou nenhuma oportunidade.</p>'
      : lista.itens.map((f) => `
        <article class="cartao clicavel" data-oportunidade="${esc(f.oportunidadeId)}">
          <h3>${esc(f.oportunidade?.titulo ?? "Oportunidade")}</h3>
          <div class="meta">${f.oportunidade?.prazoInscricao ? `Inscrições até ${esc(new Date(f.oportunidade.prazoInscricao).toLocaleDateString("pt-BR"))}` : ""}</div>
        </article>`).join(""));
  } catch (erro) {
    avisar(erro.message, true);
  }
}

async function carregarAvisos() {
  try {
    const lista = await api("GET", "/web/notificacoes?limite=50");
    conteudo.innerHTML = "<h2>Avisos</h2>" + (lista.itens.length === 0
      ? '<p class="cartao">Nenhum aviso por enquanto.</p>'
      : lista.itens.map((n) => `
        <article class="cartao">
          <h3>${n.lida ? "" : "● "}${esc(n.titulo)}</h3>
          <p>${esc(n.mensagem)}</p>
          ${n.lida ? "" : `<button class="secundario" data-acao="ler" data-id="${esc(n.id)}">Marcar como lido</button>`}
        </article>`).join(""));
  } catch (erro) {
    avisar(erro.message, true);
  }
}

// ---------- Ações ----------

document.addEventListener("click", async (evento) => {
  if (evento.target.closest("a[target=_blank]")) return; // link externo (fonte oficial): só abre a aba
  const card = evento.target.closest("[data-oportunidade]");
  if (card) return carregarDetalhe(card.dataset.oportunidade);
  const alvo = evento.target.closest("[data-acao]");
  if (!alvo) return;
  const { acao, id } = alvo.dataset;
  try {
    if (acao === "inicio") { evento.preventDefault(); return carregarFeed(); }
    if (acao === "entrar") { $("#sessao").classList.toggle("oculto"); return; }
    if (acao === "sair") return sair();
    if (acao === "assistente") return carregarAssistente();
    if (acao === "favoritos") return carregarFavoritos();
    if (acao === "avisos") return carregarAvisos();
    if (acao === "salvar") { await api("POST", "/web/favoritos", { oportunidadeId: id }); avisar("Salvo!"); return carregarDetalhe(id); }
    if (acao === "dessalvar") { await api("DELETE", `/web/favoritos/${id}`); avisar("Removido dos salvos."); return carregarFeed(); }
    if (acao === "lembrar") { await api("POST", "/web/lembretes", { oportunidadeId: id, antecedenciaHoras: 48 }); avisar("Você será avisado 48 h antes do prazo."); return; }
    if (acao === "ler") { await api("PATCH", `/web/notificacoes/${id}`, { lida: true }); return carregarAvisos(); }
  } catch (erro) {
    avisar(erro.message, true);
  }
});

desenharMenu();
carregarFeed();
