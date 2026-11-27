/**
 * Conversa com o assistente (agente LangChain do serviço Assistente, via BFF Web).
 *
 * Mostra, para cada resposta, o que o back-end informa: a origem (modelo, cache, modo degradado ou
 * recusa por escopo), as fontes citadas com o trecho usado, as ferramentas que o agente consultou,
 * a latência e os tokens. O texto do modelo entra como texto, nunca como HTML.
 *
 * A API não tem rota para ler o histórico de uma conversa, então as trocas ficam também em
 * sessionStorage, por usuário, para sobreviver a um recarregamento da página.
 */

import { ErroApi } from "../api.js";
import { sessao } from "../sessao.js";
import { h, icone, limpar } from "../ui.js";
import { criarSemente } from "./semente.js";

const TIPO_DA_FONTE = { CONHECIMENTO: "Base de conhecimento", OPORTUNIDADE: "Edital", CATALOGO: "Catálogo" };

const FERRAMENTAS = {
  consultar_base_conhecimento: "Base de conhecimento",
  buscar_oportunidades: "Catálogo de oportunidades",
  detalhar_oportunidade: "Detalhe da oportunidade"
};

const LIMITE_GUARDADO = 20;
const MAXIMO_DA_PERGUNTA = 2000;

// ---------- Texto da resposta ----------

/** Negrito, itálico e rótulos de fonte ([F1]) dentro de uma linha. Só rótulos que existem viram botão. */
function emLinha(linha, rotulosConhecidos, aoCitar) {
  const nos = [];
  const padrao = /\*\*(.+?)\*\*|\*(?!\s)([^*\n]*?[^*\s])\*|\[(F\d+)\]/g;
  let ultimo = 0;
  let achado;
  while ((achado = padrao.exec(linha)) !== null) {
    if (achado.index > ultimo) nos.push(linha.slice(ultimo, achado.index));
    if (achado[1] !== undefined) {
      nos.push(h("strong", {}, achado[1]));
    } else if (achado[2] !== undefined) {
      nos.push(h("em", {}, achado[2]));
    } else {
      const rotulo = achado[3];
      nos.push(
        rotulosConhecidos.has(rotulo)
          ? h("button", { type: "button", classe: "citacao", "aria-label": `Ver a fonte ${rotulo}`, aoClick: () => aoCitar(rotulo) }, rotulo)
          : `[${rotulo}]`
      );
    }
    ultimo = padrao.lastIndex;
  }
  if (ultimo < linha.length) nos.push(linha.slice(ultimo));
  return nos;
}

/**
 * Parágrafos e listas (- item, 1. item), com sub-itens: um marcador recuado, ou um marcador "-" logo abaixo
 * de um item numerado, vira sub-lista daquele item. Não interpreta HTML nem links: tudo entra como texto.
 */
function blocosDoTexto(texto, rotulosConhecidos, aoCitar) {
  const saida = [];
  let lista = null; // { tipo, elemento, ultimoItem, ultimaLinhaFoiItem }
  let paragrafo = null;
  for (const linha of texto.replace(/\r/g, "").split("\n")) {
    const item = linha.match(/^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      paragrafo = null;
      const recuo = item[1].length;
      const tipo = item[2] ? "ul" : "ol";
      const conteudo = h("li", {}, emLinha(item[4], rotulosConhecidos, aoCitar));
      const aninhar = lista && lista.ultimoItem && (recuo >= 2 || (lista.tipo === "ol" && tipo === "ul" && lista.ultimaLinhaFoiItem));
      if (aninhar) {
        let sub = lista.ultimoItem.querySelector(":scope > ul.texto-lista");
        if (!sub) {
          sub = h("ul", { classe: "texto-lista" });
          lista.ultimoItem.append(sub);
        }
        sub.append(conteudo);
      } else {
        if (!lista || lista.tipo !== tipo) {
          lista = { tipo, elemento: h(tipo, { classe: "texto-lista", ...(tipo === "ol" && Number(item[3]) > 1 ? { start: item[3] } : {}) }), ultimoItem: null };
          saida.push(lista.elemento);
        }
        lista.elemento.append(conteudo);
        lista.ultimoItem = conteudo;
      }
      lista.ultimaLinhaFoiItem = true;
    } else if (linha.trim() === "") {
      paragrafo = null;
      lista = null;
    } else {
      lista = null;
      if (!paragrafo) {
        paragrafo = h("p", {});
        saida.push(paragrafo);
      } else {
        paragrafo.append(h("br"));
      }
      paragrafo.append(...emLinha(linha, rotulosConhecidos, aoCitar).flat());
    }
  }
  return saida;
}

// ---------- Mensagens ----------

function mensagemDoUsuario(texto) {
  return h("div", { classe: "mensagem mensagem--usuario" }, h("p", {}, texto));
}

function mensagemPensando() {
  const texto = h("span", {}, "Pensando…");
  const semente = criarSemente({ tamanho: 40, estado: "pensando" });
  const elemento = h("div", { classe: "mensagem mensagem--assistente mensagem--pensando", role: "status" }, semente, texto);
  const aviso = setTimeout(() => {
    texto.textContent = "Ainda trabalhando. O modelo pode levar alguns segundos.";
  }, 8000);
  return { elemento, parar: () => clearTimeout(aviso) };
}

function mensagemDeErro(erro, aoTentar) {
  return h(
    "div",
    { classe: "mensagem mensagem--erro", role: "alert" },
    icone("circle-alert"),
    h("div", {}, h("p", {}, erro.message), h("button", { type: "button", classe: "botao botao--contorno botao--p", aoClick: aoTentar }, icone("refresh-cw"), "Tentar de novo"))
  );
}

function seloDaOrigem(m) {
  switch (m.origem) {
    case "LLM":
      return { icone: "sprout", texto: `Resposta gerada por IA${m.modelo ? ` · ${m.modelo}` : ""}` };
    case "CACHE":
      return { icone: "layers", texto: "Resposta reaproveitada de uma pergunta igual ou parecida" };
    case "FALLBACK":
      return { icone: "triangle-alert", texto: "Modo degradado: sem texto gerado por IA, só os trechos encontrados" };
    case "RECUSA":
      return { icone: "info", texto: "Fora do escopo do ConectaU" };
    default:
      return { icone: "info", texto: "Resposta do assistente" };
  }
}

function fontesDaMensagem(m, prefixo) {
  const citadas = m.fontes.filter((f) => f.citada);
  // Em modo degradado a própria resposta lista os trechos; nos outros, mostra o que o modelo citou.
  const lista = citadas.length > 0 ? citadas : m.fontes;
  if (lista.length === 0) return null;
  return h(
    "details",
    { classe: "fontes", ...(m.origem === "FALLBACK" ? { open: true } : {}) },
    h("summary", {}, icone("book-open"), `Fontes (${lista.length})`),
    h(
      "ul",
      { classe: "fontes__lista" },
      lista.map((f) =>
        h(
          "li",
          { classe: "fonte", id: `${prefixo}-${f.id}` },
          h(
            "div",
            { classe: "fonte__cabeca" },
            h("span", { classe: "chip chip--musgo" }, f.id),
            h("span", { classe: "chip chip--vazado" }, TIPO_DA_FONTE[f.tipo] ?? f.tipo),
            h("strong", {}, f.titulo)
          ),
          h("p", { classe: "fonte__trecho" }, f.trecho),
          h(
            "div",
            { classe: "linha" },
            f.oportunidadeId && h("a", { classe: "botao botao--suave botao--p", href: `#/oportunidades/${f.oportunidadeId}` }, icone("file-text"), "Abrir oportunidade"),
            f.fonteUrl && h("a", { classe: "botao botao--contorno botao--p", href: f.fonteUrl, target: "_blank", rel: "noopener noreferrer" }, icone("external-link"), "Fonte oficial")
          )
        )
      )
    )
  );
}

function mensagemDoAssistente(m, prefixo) {
  const selo = seloDaOrigem(m);
  const fontes = fontesDaMensagem(m, prefixo);
  const elemento = h("div", { classe: "mensagem mensagem--assistente", dataset: { origem: m.origem } });

  const rotulos = new Set((m.fontes ?? []).map((f) => f.id));
  const aoCitar = (rotulo) => {
    const detalhes = elemento.querySelector("details.fontes");
    if (detalhes) detalhes.open = true;
    const alvo = elemento.querySelector(`[id="${prefixo}-${rotulo}"]`);
    if (!alvo) return;
    alvo.scrollIntoView({ block: "center", behavior: "smooth" });
    alvo.classList.add("fonte--destaque");
    setTimeout(() => alvo.classList.remove("fonte--destaque"), 1800);
  };

  const ferramentas = (m.ferramentas ?? []).map((f) => FERRAMENTAS[f.nome] ?? f.nome);
  const tokens = (m.tokens?.entrada ?? 0) + (m.tokens?.saida ?? 0);

  // Element.append(null) escreveria o texto "null" na tela: partes ausentes (sem fontes) ficam de fora.
  elemento.append(
    ...[
      h("div", { classe: "mensagem__selo" }, icone(selo.icone), selo.texto),
      h("div", { classe: "mensagem__texto" }, blocosDoTexto(m.resposta, rotulos, aoCitar)),
      fontes,
      h(
        "p",
        { classe: "mensagem__meta" },
        ferramentas.length > 0 && h("span", {}, icone("search"), `Consultou: ${[...new Set(ferramentas)].join(", ")}`),
        h("span", { classe: "numero" }, icone("timer"), `${m.latenciaMs} ms`),
        tokens > 0 && h("span", { classe: "numero" }, `${tokens} tokens`)
      )
    ].filter(Boolean)
  );
  return elemento;
}

// ---------- Armazenamento local ----------

function chaveLocal(chave) {
  return `conectau.conversa.${sessao()?.usuarioId ?? "anonimo"}.${chave}`;
}

function lerLocal(chave) {
  try {
    const bruto = sessionStorage.getItem(chaveLocal(chave));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function gravarLocal(chave, estado) {
  try {
    sessionStorage.setItem(chaveLocal(chave), JSON.stringify(estado));
  } catch {
    /* sem armazenamento: a conversa só não sobrevive a um recarregamento */
  }
}

function apagarLocal(chave) {
  try {
    sessionStorage.removeItem(chaveLocal(chave));
  } catch {
    /* nada a apagar */
  }
}

// ---------- Componente ----------

/**
 * @param {object} opcoes
 * @param {object} opcoes.api                 catálogo de rotas (js/api.js)
 * @param {{id: string, titulo: string}} [opcoes.oportunidade]  restringe a conversa a um edital
 * @param {string} opcoes.chave               identifica a conversa no armazenamento local
 * @param {string[]} [opcoes.sugestoes]       perguntas prontas para a primeira mensagem
 * @param {Node} [opcoes.apresentacao]        texto exibido enquanto a conversa está vazia
 * @param {string} [opcoes.placeholder]
 */
export function criarConversa({ api, oportunidade, chave, sugestoes = [], apresentacao, placeholder }) {
  const guardado = lerLocal(chave) ?? { conversaId: null, trocas: [] };
  let conversaId = guardado.conversaId;
  let trocas = guardado.trocas;
  let pendente = false;
  let contagem = 0;

  const historico = h("div", { classe: "conversa__historico", role: "log", "aria-live": "polite", "aria-relevant": "additions" });
  const inicio = h("div", { classe: "conversa__inicio" });
  const entrada = h("textarea", {
    id: `pergunta-${chave}`,
    name: "pergunta",
    rows: 1,
    maxlength: MAXIMO_DA_PERGUNTA,
    required: true,
    placeholder: placeholder ?? "Escreva sua pergunta",
    "aria-label": "Sua pergunta"
  });
  const enviarBotao = h("button", { type: "submit", classe: "botao botao--destaque" }, icone("send"), "Enviar");
  const novaConversa = h(
    "button",
    { type: "button", classe: "botao botao--suave botao--p", aoClick: reiniciar },
    icone("rotate-ccw"),
    "Nova conversa"
  );
  const formulario = h("form", { classe: "compositor", aoSubmit: aoEnviar }, entrada, enviarBotao);
  const raiz = h("section", { classe: "conversa", "aria-label": oportunidade ? `Conversa sobre ${oportunidade.titulo}` : "Conversa com o assistente" }, inicio, historico, formulario);

  function desenharInicio() {
    limpar(inicio);
    if (trocas.length > 0) {
      inicio.append(h("div", { classe: "linha linha--entre" }, h("span", { classe: "suave pequeno" }, `${trocas.length} ${trocas.length === 1 ? "pergunta" : "perguntas"} nesta conversa`), novaConversa));
      return;
    }
    if (apresentacao) inicio.append(apresentacao);
    if (sugestoes.length > 0) {
      inicio.append(
        h(
          "div",
          { classe: "sugestoes" },
          h("p", { classe: "suave pequeno" }, "Para começar:"),
          h(
            "div",
            { classe: "lista-chips" },
            sugestoes.map((texto) => h("button", { type: "button", classe: "sugestao", aoClick: () => void enviar(texto) }, texto))
          )
        )
      );
    }
  }

  function atualizarFormulario() {
    entrada.disabled = pendente;
    enviarBotao.disabled = pendente;
    enviarBotao.toggleAttribute("aria-busy", pendente);
  }

  function rolarParaOFim() {
    raiz.querySelector(".conversa__historico")?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function reiniciar() {
    conversaId = null;
    trocas = [];
    apagarLocal(chave);
    limpar(historico);
    desenharInicio();
    entrada.focus();
  }

  function guardar() {
    gravarLocal(chave, { conversaId, trocas: trocas.slice(-LIMITE_GUARDADO) });
  }

  async function perguntarComRecuperacao(texto, jaRecriou = false) {
    if (!conversaId) {
      conversaId = (await api.web.criarConversa(oportunidade?.id)).id;
      guardar();
    }
    try {
      return await api.web.perguntar(conversaId, texto);
    } catch (erro) {
      // A conversa pode ter sumido (banco recriado) ou ser de outra conta: abre uma nova e repete uma vez.
      if (!jaRecriou && erro instanceof ErroApi && (erro.status === 404 || erro.status === 403)) {
        conversaId = null;
        return perguntarComRecuperacao(texto, true);
      }
      throw erro;
    }
  }

  async function enviar(texto) {
    const pergunta = texto.trim();
    if (!pergunta || pendente) return;
    pendente = true;
    atualizarFormulario();
    if (trocas.length === 0) limpar(inicio);

    const doUsuario = mensagemDoUsuario(pergunta);
    const pensando = mensagemPensando();
    historico.append(doUsuario, pensando.elemento);
    rolarParaOFim();

    try {
      const resposta = await perguntarComRecuperacao(pergunta);
      pensando.parar();
      contagem += 1;
      pensando.elemento.replaceWith(mensagemDoAssistente(resposta, `${chave}-${Date.now()}-${contagem}`));
      trocas.push({ pergunta, resposta });
      guardar();
      desenharInicio();
    } catch (erro) {
      pensando.parar();
      const falha = mensagemDeErro(erro, () => {
        doUsuario.remove();
        falha.remove();
        void enviar(pergunta);
      });
      pensando.elemento.replaceWith(falha);
    } finally {
      pendente = false;
      atualizarFormulario();
      rolarParaOFim();
    }
  }

  function aoEnviar(evento) {
    evento.preventDefault();
    const texto = entrada.value;
    if (texto.trim() === "") return;
    entrada.value = "";
    ajustarAltura();
    void enviar(texto);
  }

  function ajustarAltura() {
    entrada.style.height = "auto";
    entrada.style.height = `${Math.min(entrada.scrollHeight + 4, 168)}px`;
  }

  entrada.addEventListener("input", ajustarAltura);
  entrada.addEventListener("keydown", (evento) => {
    // Enter envia; Shift+Enter quebra a linha. Não interfere na composição de acentos.
    if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      formulario.requestSubmit();
    }
  });

  // Restaura a conversa guardada.
  for (const troca of trocas) {
    contagem += 1;
    historico.append(mensagemDoUsuario(troca.pergunta), mensagemDoAssistente(troca.resposta, `${chave}-restaurada-${contagem}`));
  }
  desenharInicio();
  atualizarFormulario();

  return { elemento: raiz, focar: () => entrada.focus() };
}
