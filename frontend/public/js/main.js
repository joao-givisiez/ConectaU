/** Ponto de entrada: monta a navegação, liga o cliente da API ao gateway e inicia o roteador. */

import { criarApi, criarCliente } from "./api.js";
import { ctx } from "./contexto.js";
import { iniciarRoteador } from "./roteador.js";
import { aoMudarSessao, ehAdmin, encerrarSessao, estaLogado, sessao, token } from "./sessao.js";
import { avisar, h, icone, limpar, primeiroNome } from "./ui.js";

const cliente = criarCliente({
  obterToken: token,
  aoNaoAutenticado: () => {
    encerrarSessao();
    avisar("Sua sessão expirou. Entre novamente.", { erro: true });
    ctx.ir("/entrar");
  }
});
ctx.api = criarApi(cliente);

// ---------- Navegação ----------

const ITENS = [
  { grupo: "inicio", rota: "/", rotulo: "Oportunidades", icone: "search" },
  { grupo: "assistente", rota: "/assistente", rotulo: "Assistente", icone: "message-circle" },
  { grupo: "salvos", rota: "/salvos", rotulo: "Salvos", icone: "bookmark", logado: true },
  { grupo: "avisos", rota: "/avisos", rotulo: "Avisos", icone: "bell", logado: true, contador: true },
  { grupo: "curadoria", rota: "/curadoria", rotulo: "Curadoria", icone: "clipboard-list", admin: true }
];

let grupoAtual = "inicio";

function contador() {
  const quantidade = ctx.avisosNaoLidos;
  if (!quantidade) return null;
  return h("span", { classe: "contador", "aria-label": `${quantidade} não lidos` }, quantidade > 99 ? "99+" : quantidade);
}

function itensVisiveis() {
  return ITENS.filter((item) => (!item.logado || estaLogado()) && (!item.admin || ehAdmin()));
}

function desenharNavegacao() {
  const nav = limpar(document.getElementById("nav-principal"));
  const abas = limpar(document.getElementById("abas-inferiores"));
  const usuario = limpar(document.getElementById("topo-usuario"));

  for (const item of itensVisiveis()) {
    const atual = item.grupo === grupoAtual ? { "aria-current": "page" } : {};
    nav.append(h("a", { classe: "nav-link", href: `#${item.rota}`, ...atual }, item.rotulo, item.contador && contador()));
    abas.append(
      h("a", { classe: "aba-inferior", href: `#${item.rota}`, ...atual }, icone(item.icone), item.rotulo, item.contador && contador())
    );
  }

  if (estaLogado()) {
    const nome = primeiroNome(sessao().nome);
    usuario.append(
      h("a", { classe: "nav-link", href: "#/perfil", "aria-label": nome ? `Meu perfil (${nome})` : "Meu perfil", ...(grupoAtual === "conta" ? { "aria-current": "page" } : {}) },
        icone("user"), h("span", { classe: "topo__nome", "aria-hidden": "true" }, nome || "Meu perfil")),
      h("button", { type: "button", classe: "botao botao--contorno botao--p", aoClick: sair }, icone("log-out"), "Sair")
    );
    abas.append(
      h("a", { classe: "aba-inferior", href: "#/perfil", ...(grupoAtual === "conta" ? { "aria-current": "page" } : {}) },
        icone("user"), "Perfil")
    );
  } else {
    usuario.append(h("a", { classe: "botao botao--p", href: "#/entrar" }, icone("log-in"), "Entrar"));
    abas.append(
      h("a", { classe: "aba-inferior", href: "#/entrar", ...(grupoAtual === "conta" ? { "aria-current": "page" } : {}) },
        icone("log-in"), "Entrar")
    );
  }
}

function sair() {
  encerrarSessao();
  avisar("Você saiu do ConectaU.");
  if (location.hash === "#/" || location.hash === "") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else ctx.ir("/");
}

// ---------- Avisos não lidos ----------

let temporizadorDeAvisos;

ctx.atualizarAvisos = async () => {
  if (!estaLogado()) {
    ctx.avisosNaoLidos = 0;
    desenharNavegacao();
    return;
  }
  try {
    const lista = await ctx.api.web.notificacoes({ lida: false, limite: 1 });
    ctx.avisosNaoLidos = lista.total;
  } catch {
    /* o contador é só um complemento: se falhar, a navegação continua */
  }
  desenharNavegacao();
};

function acompanharAvisos() {
  clearInterval(temporizadorDeAvisos);
  void ctx.atualizarAvisos();
  if (estaLogado()) temporizadorDeAvisos = setInterval(() => void ctx.atualizarAvisos(), 60000);
}

aoMudarSessao(() => {
  ctx.avisosNaoLidos = 0;
  acompanharAvisos();
});

// ---------- Início ----------

const roteador = iniciarRoteador({
  raiz: document.getElementById("raiz"),
  aoNavegar: ({ grupo }) => {
    grupoAtual = grupo;
    desenharNavegacao();
  }
});

desenharNavegacao();
acompanharAvisos();
void roteador.resolver();
