// Painel Admin do ConectaU. Fala só com o gateway: /auth/sessoes e /admin/** (exige role=ADMIN).
"use strict";

const $ = (seletor) => document.querySelector(seletor);
const conteudo = $("#conteudo");
let token = lerSessao();
let acompanhamento;

function lerSessao() {
  try { return sessionStorage.getItem("conectau.admin.token"); } catch { return null; }
}
function gravarSessao(valor) {
  try {
    if (valor) sessionStorage.setItem("conectau.admin.token", valor);
    else sessionStorage.removeItem("conectau.admin.token");
  } catch { /* sem armazenamento */ }
}

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function avisar(mensagem, erro = false) {
  const aviso = $("#aviso");
  aviso.textContent = mensagem;
  aviso.className = `aviso${erro ? " erro" : ""}`;
  clearTimeout(avisar.temporizador);
  avisar.temporizador = setTimeout(() => aviso.classList.add("oculto"), 6000);
}

async function api(metodo, caminho, corpo) {
  const cabecalhos = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  const resposta = await fetch(caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  if (resposta.status === 401) { sair(); throw new Error("Sessão expirada; entre novamente."); }
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : undefined;
  if (!resposta.ok) throw new Error(dados?.mensagem ?? `Erro ${resposta.status}`);
  return dados;
}

const data = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");

function paraDataLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---------- Sessão ----------

function mostrarPainel() {
  $("#login").classList.add("oculto");
  $("#painel").classList.remove("oculto");
  $("#menu").innerHTML = '<button class="secundario" data-acao="sair">Sair</button>';
  abrirAba("curadoria");
}

function sair() {
  token = null;
  gravarSessao(null);
  clearInterval(acompanhamento);
  $("#painel").classList.add("oculto");
  $("#login").classList.remove("oculto");
  $("#menu").innerHTML = "";
}

$("#form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  try {
    const resposta = await fetch("/auth/sessoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(evento.target)))
    });
    const sessao = await resposta.json();
    if (!resposta.ok) throw new Error(sessao.mensagem);
    if (sessao.papel !== "ADMIN") throw new Error("Esta conta não é de administrador.");
    token = sessao.token;
    gravarSessao(token);
    mostrarPainel();
  } catch (erro) {
    alert(erro.message);
  }
});

// ---------- Abas ----------

function abrirAba(aba) {
  clearInterval(acompanhamento);
  document.querySelectorAll("[data-aba]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aba === aba)));
  if (aba === "curadoria") carregarCuradoria();
  else carregarOportunidades(aba);
}

async function carregarCuradoria() {
  try {
    const [candidatos, fontes] = await Promise.all([
      api("GET", "/admin/candidatos?status=PENDENTE&limite=50"),
      api("GET", "/admin/fontes")
    ]);
    conteudo.innerHTML = `
      <div class="cartao">
        <h2>Fila de curadoria (${candidatos.total} pendente(s))</h2>
        <div class="acoes">
          ${fontes.itens.map((f) => `<button class="secundario" data-acao="coletar" data-id="${esc(f.id)}">Executar coleta: ${esc(f.nome)}</button>`).join("")}
          <button class="secundario" data-acao="manual">Cadastro manual</button>
        </div>
        <div id="area-manual"></div>
      </div>
      ${candidatos.itens.map((c) => `
        <article class="cartao">
          <h3>${esc(c.tituloExtraido)}</h3>
          <div class="meta">
            <span class="etiqueta">${esc(c.origem)}</span>
            <span>Coletado em ${esc(data(c.coletadoEm))}</span>
            ${c.dataExtraida ? `<span>Data: ${esc(data(c.dataExtraida))}</span>` : ""}
            <span>Similaridade com outros: ${esc(c.scoreDuplicidade)}</span>
          </div>
          <p>${esc(c.descricaoExtraida ?? "")}</p>
          <div class="acoes">
            <button data-acao="criar" data-id="${esc(c.id)}">Criar oportunidade</button>
            <button class="secundario" data-acao="descartar" data-id="${esc(c.id)}">Descartar</button>
            <button class="secundario" data-acao="duplicado" data-id="${esc(c.id)}">Marcar duplicado</button>
          </div>
          <div id="form-${esc(c.id)}"></div>
        </article>`).join("")}`;
    conteudo.dataset.candidatos = JSON.stringify(candidatos.itens);
  } catch (erro) {
    avisar(erro.message, true);
  }
}

function formularioOportunidade(c) {
  const prazo = c.dataExtraida ? new Date(new Date(c.dataExtraida).getTime() - 2 * 86400000).toISOString() : "";
  return `
    <form class="form-oportunidade" data-candidato="${esc(c.id)}">
      <label>Título <input name="titulo" required value="${esc(c.tituloExtraido)}"></label>
      <label>Descrição <textarea name="descricao" rows="4">${esc(c.descricaoExtraida ?? "")}</textarea></label>
      <div class="grade">
        <label>Categoria
          <select name="categoria">
            <option>EVENTO</option><option>ATIVIDADE</option><option>BOLSA</option><option>PROJETO</option><option>PROCESSO_SELETIVO</option>
          </select>
        </label>
        <label>Campus
          <select name="campus"><option value="LAVRAS">Lavras</option><option value="SAO_SEBASTIAO_DO_PARAISO">São Sebastião do Paraíso</option></select>
        </label>
        <label>Início <input name="dataInicio" type="datetime-local" value="${esc(paraDataLocal(c.dataExtraida))}"></label>
        <label>Prazo de inscrição <input name="prazoInscricao" type="datetime-local" required value="${esc(paraDataLocal(prazo))}"></label>
      </div>
      <label>Fonte oficial (URL) <input name="fonteUrl" type="url" required value="${esc(c.urlOrigem)}"></label>
      <label>Tags (separadas por vírgula) <input name="tags" placeholder="tecnologia, containers"></label>
      <div class="acoes"><button type="submit">Salvar como rascunho</button></div>
    </form>`;
}

async function carregarOportunidades(status) {
  try {
    const lista = await api("GET", `/admin/oportunidades?status=${status}&limite=50`);
    conteudo.innerHTML = `<h2>${esc(status)} (${lista.total})</h2>` + (lista.itens.length === 0
      ? '<p class="cartao">Nada aqui.</p>'
      : lista.itens.map((o) => `
        <article class="cartao">
          <h3>${esc(o.titulo)}</h3>
          <div class="meta">
            <span class="etiqueta">${esc(o.categoria)}</span><span>${esc(o.campus)}</span>
            <span>Prazo: ${esc(data(o.prazoInscricao))}</span><span>Versão ${esc(o.versao)}</span>
          </div>
          <div class="acoes">
            <button class="secundario" data-acao="detalhe" data-id="${esc(o.id)}">Ver registro completo</button>
            ${o._links.publicar ? `<button data-acao="publicar" data-id="${esc(o.id)}">Publicar (SAGA)</button>` : ""}
            ${o._links.encerrar ? `<button class="secundario" data-acao="encerrar" data-id="${esc(o.id)}">Encerrar</button>` : ""}
            ${o._links.excluir ? `<button class="secundario" data-acao="excluir" data-id="${esc(o.id)}">Excluir</button>` : ""}
          </div>
          <div id="detalhe-${esc(o.id)}"></div>
        </article>`).join(""));
  } catch (erro) {
    avisar(erro.message, true);
  }
}

function desenharSaga(saga) {
  return `
    <p>SAGA <code>${esc(saga.sagaId ?? saga.id)}</code>: <span class="estado-${esc(saga.estado)}">${esc(saga.estado)}</span></p>
    ${saga.erro ? `<p class="meta">Motivo: ${esc(saga.erro)}</p>` : ""}
    <ol class="passos">
      ${(saga.passos ?? []).map((p) => `
        <li><span>${esc(p.passo)}</span><span class="estado-${esc(p.estado)}">${esc(p.estado)}</span>
        ${p.detalhe ? `<span class="meta">${esc(p.detalhe)}</span>` : ""}</li>`).join("")}
    </ol>`;
}

/** Acompanha a SAGA ao vivo até ela terminar (CONCLUIDA, COMPENSADA ou FALHA_COMPENSACAO). */
function acompanharSaga(sagaId, alvo) {
  clearInterval(acompanhamento);
  const atualizar = async () => {
    try {
      const saga = await api("GET", `/admin/publicacoes/${sagaId}`);
      alvo.innerHTML = desenharSaga(saga);
      if (["CONCLUIDA", "COMPENSADA", "FALHA_COMPENSACAO"].includes(saga.estado)) {
        clearInterval(acompanhamento);
        avisar(saga.estado === "CONCLUIDA" ? "Publicada!" : `Publicação não concluída: ${saga.estado}`, saga.estado !== "CONCLUIDA");
      }
    } catch (erro) {
      clearInterval(acompanhamento);
      avisar(erro.message, true);
    }
  };
  atualizar();
  acompanhamento = setInterval(atualizar, 700);
}

// ---------- Ações ----------

document.addEventListener("click", async (evento) => {
  const aba = evento.target.closest("[data-aba]");
  if (aba) return abrirAba(aba.dataset.aba);
  const alvo = evento.target.closest("[data-acao]");
  if (!alvo) return;
  const { acao, id } = alvo.dataset;
  try {
    if (acao === "sair") return sair();
    if (acao === "coletar") {
      const execucao = await api("POST", "/admin/execucoes", { fonteId: id });
      avisar(`Coleta ${execucao.estado}: ${execucao.itensNovos} novo(s), ${execucao.itensDuplicados} duplicado(s).`);
      return carregarCuradoria();
    }
    if (acao === "manual") {
      $("#area-manual").innerHTML = `
        <form id="form-manual">
          <label>Título <input name="titulo" required></label>
          <label>Descrição <textarea name="descricao" rows="3"></textarea></label>
          <div class="grade">
            <label>Data <input name="data" type="datetime-local"></label>
            <label>Quem pediu a divulgação <input name="solicitante"></label>
          </div>
          <label>Canal oficial (URL) <input name="urlOrigem" type="url" required></label>
          <div class="acoes"><button type="submit">Registrar candidato</button></div>
        </form>`;
      return;
    }
    if (acao === "criar") {
      const candidato = JSON.parse(conteudo.dataset.candidatos).find((c) => c.id === id);
      $(`#form-${CSS.escape(id)}`).innerHTML = formularioOportunidade(candidato);
      return;
    }
    if (acao === "descartar" || acao === "duplicado") {
      await api("PATCH", `/admin/candidatos/${id}`, { status: acao === "descartar" ? "DESCARTADO" : "DUPLICADO" });
      avisar("Candidato atualizado.");
      return carregarCuradoria();
    }
    if (acao === "detalhe") {
      const registro = await api("GET", `/admin/oportunidades/${id}`);
      const { saga, ...resto } = registro;
      $(`#detalhe-${CSS.escape(id)}`).innerHTML = (saga ? desenharSaga(saga) : "") + `<pre>${esc(JSON.stringify(resto, null, 2))}</pre>`;
      return;
    }
    if (acao === "publicar") {
      const resposta = await api("POST", `/admin/oportunidades/${id}/publicacao`);
      avisar("Publicação aceita (202). Acompanhando a SAGA…");
      return acompanharSaga(resposta.sagaId, $(`#detalhe-${CSS.escape(id)}`));
    }
    if (acao === "encerrar") {
      if (!confirm("Encerrar esta oportunidade?")) return;
      await api("POST", `/admin/oportunidades/${id}/encerramento`);
      avisar("Oportunidade encerrada.");
      return carregarOportunidades("PUBLICADA");
    }
    if (acao === "excluir") {
      if (!confirm("Excluir este rascunho?")) return;
      await api("DELETE", `/admin/oportunidades/${id}`);
      avisar("Rascunho excluído.");
      return carregarOportunidades("RASCUNHO");
    }
  } catch (erro) {
    avisar(erro.message, true);
  }
});

document.addEventListener("submit", async (evento) => {
  const form = evento.target;
  if (form.id === "form-manual") {
    evento.preventDefault();
    const dados = Object.fromEntries(new FormData(form));
    dados.data = dados.data ? new Date(dados.data).toISOString() : undefined;
    try {
      await api("POST", "/admin/candidatos", dados);
      avisar("Candidato manual registrado.");
      carregarCuradoria();
    } catch (erro) {
      avisar(erro.message, true);
    }
  }
  if (form.classList.contains("form-oportunidade")) {
    evento.preventDefault();
    const dados = Object.fromEntries(new FormData(form));
    const corpo = {
      candidatoId: form.dataset.candidato,
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      campus: dados.campus,
      dataInicio: dados.dataInicio ? new Date(dados.dataInicio).toISOString() : undefined,
      prazoInscricao: new Date(dados.prazoInscricao).toISOString(),
      fonteUrl: dados.fonteUrl,
      tags: dados.tags.split(",").map((t) => t.trim()).filter(Boolean)
    };
    try {
      await api("POST", "/admin/oportunidades", corpo);
      avisar("Rascunho criado. Publique pela aba Rascunhos.");
      form.remove();
    } catch (erro) {
      avisar(erro.message, true);
    }
  }
});

if (token) mostrarPainel();
