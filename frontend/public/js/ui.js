/**
 * Utilidades de interface. Todo conteúdo que vem do servidor (títulos, editais, respostas do modelo)
 * entra na página como TEXTO (createTextNode), nunca como HTML: a função h() não tem caminho para innerHTML.
 */

import { ICONES } from "./icones.js";

const NS_SVG = "http://www.w3.org/2000/svg";

/**
 * Cria um elemento. Propriedades especiais: `classe`, `dataset`, `valor` e `aoXxx` (eventos).
 * Filhos: texto, nós, listas (achatadas) ou nulo/falso (ignorados).
 */
export function h(tag, props = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props ?? {})) {
    if (valor === undefined || valor === null || valor === false || chave === "valor") continue;
    if (chave === "classe") elemento.className = valor;
    else if (chave === "dataset") Object.assign(elemento.dataset, valor);
    else if (chave.startsWith("ao") && typeof valor === "function") {
      elemento.addEventListener(chave.slice(2).toLowerCase(), valor);
    } else elemento.setAttribute(chave, valor === true ? "" : String(valor));
  }
  anexar(elemento, filhos);
  // `valor` entra depois dos filhos, porque <select> só aceita valor depois de ter as <option>.
  if (props?.valor !== undefined && props.valor !== null) elemento.value = props.valor;
  return elemento;
}

function anexar(pai, filhos) {
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    pai.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
}

export function limpar(no) {
  while (no.firstChild) no.removeChild(no.firstChild);
  return no;
}

/** Ícone Lucide (SVG inline). Sem `rotulo`, o ícone é decorativo e some para leitores de tela. */
export function icone(nome, { classe = "", rotulo } = {}) {
  const miolo = ICONES[nome];
  if (!miolo) throw new Error(`Ícone desconhecido: ${nome}`);
  const svg = document.createElementNS(NS_SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icone ${classe}`.trim());
  if (rotulo) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", rotulo);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  svg.innerHTML = miolo; // constante do próprio projeto (js/icones.js), nunca dado do usuário
  return svg;
}

// ---------- Avisos (toasts) ----------

export function avisar(mensagem, { erro = false, duracaoMs = 6000 } = {}) {
  const area = document.getElementById("avisos");
  if (!area) return;
  const aviso = h(
    "div",
    { classe: `aviso${erro ? " aviso--erro" : ""}`, role: erro ? "alert" : "status" },
    icone(erro ? "circle-alert" : "check"),
    h("span", { classe: "aviso__texto" }, mensagem),
    h("button", { type: "button", "aria-label": "Fechar aviso", aoClick: () => aviso.remove() }, icone("x"))
  );
  area.append(aviso);
  while (area.children.length > 3) area.firstChild.remove();
  setTimeout(() => aviso.remove(), duracaoMs);
}

// ---------- Diálogo de confirmação ----------

export function confirmar({ titulo, mensagem, confirmar: rotulo = "Confirmar", perigo = false }) {
  return new Promise((resolver) => {
    const dialogo = h(
      "dialog",
      { classe: "dialogo", "aria-labelledby": "dialogo-titulo" },
      h("h2", { id: "dialogo-titulo" }, titulo),
      h("p", { classe: "suave" }, mensagem),
      h(
        "div",
        { classe: "dialogo__acoes" },
        h("button", { type: "button", classe: "botao botao--contorno", aoClick: () => dialogo.close("cancelar") }, "Cancelar"),
        h(
          "button",
          { type: "button", classe: `botao ${perigo ? "botao--destaque" : ""}`, aoClick: () => dialogo.close("confirmar") },
          rotulo
        )
      )
    );
    dialogo.addEventListener("close", () => {
      resolver(dialogo.returnValue === "confirmar");
      dialogo.remove();
    });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

// ---------- Formatação ----------

export const CATEGORIAS = {
  EVENTO: "Evento",
  ATIVIDADE: "Atividade",
  BOLSA: "Bolsa",
  PROJETO: "Projeto",
  PROCESSO_SELETIVO: "Processo seletivo"
};

export const CAMPI = {
  LAVRAS: "Lavras",
  SAO_SEBASTIAO_DO_PARAISO: "São Sebastião do Paraíso"
};

export const STATUS = {
  RASCUNHO: "Rascunho",
  PUBLICANDO: "Publicando",
  PUBLICADA: "Publicada",
  ENCERRADA: "Encerrada"
};

const FUSO = "America/Sao_Paulo";

export function dataCurta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO });
}

export function dataHora(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
}

/** Data pura (AAAA-MM-DD, como o BFF entrega em `quando`): o meio-dia evita virar o dia anterior por fuso. */
export function dataDoDia(texto) {
  if (!texto) return "";
  return new Date(`${texto}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" });
}

export function textoPrazo(dias) {
  if (dias === 0) return "Prazo termina hoje";
  return dias === 1 ? "Falta 1 dia" : `Faltam ${dias} dias`;
}

/** Faixas do prazo: usadas para escolher o selo (cores do sistema, sempre acompanhadas de texto). */
export function urgencia(dias) {
  if (dias <= 3) return "urgente";
  if (dias <= 14) return "atencao";
  return "tranquilo";
}

export function primeiroNome(nome) {
  return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

export function listaDeTags(texto) {
  return String(texto ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Valor de <input type="datetime-local"> a partir de uma data ISO (no horário local do navegador). */
export function paraCampoDataHora(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  data.setMinutes(data.getMinutes() - data.getTimezoneOffset());
  return data.toISOString().slice(0, 16);
}

export function deCampoDataHora(texto) {
  return texto ? new Date(texto).toISOString() : undefined;
}

// ---------- Blocos reutilizáveis ----------

export function blocoVazio(nomeIcone, mensagem, ...acoes) {
  return h("div", { classe: "vazio" }, icone(nomeIcone), h("p", {}, mensagem), ...acoes);
}

export function blocoErro(erro, aoTentar) {
  return h(
    "div",
    { classe: "bloco-erro", role: "alert" },
    h("p", {}, erro?.message ?? "Algo deu errado."),
    aoTentar && h("button", { type: "button", classe: "botao botao--contorno botao--p", aoClick: aoTentar }, icone("refresh-cw"), "Tentar de novo")
  );
}

export function esqueletos(quantidade = 4) {
  return h(
    "div",
    { classe: "grade-cartoes", "aria-busy": "true", "aria-label": "Carregando" },
    Array.from({ length: quantidade }, () => h("div", { classe: "esqueleto" }))
  );
}

/** Campo de formulário com rótulo visível. `controle` é o <input>/<select>/<textarea> já criado. */
export function campo(rotulo, controle, { ajuda, largo = false } = {}) {
  const id = controle.id || `c-${Math.random().toString(36).slice(2, 8)}`;
  controle.id = id;
  return h(
    "div",
    { classe: `campo${largo ? " largo" : ""}` },
    h("label", { classe: "campo__rotulo", for: id }, rotulo),
    controle,
    ajuda && h("span", { classe: "campo__ajuda" }, ajuda)
  );
}

export function opcoes(mapa) {
  return Object.entries(mapa).map(([valor, texto]) => h("option", { value: valor }, texto));
}

/** Desativa o botão durante uma ação assíncrona e sempre o reativa depois. */
export async function comEspera(botao, tarefa) {
  botao.disabled = true;
  botao.setAttribute("aria-busy", "true");
  try {
    return await tarefa();
  } finally {
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
  }
}
