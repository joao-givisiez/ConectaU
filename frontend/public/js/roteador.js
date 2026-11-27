/**
 * Roteador por hash (#/caminho?consulta). Funciona servido de qualquer prefixo (por exemplo /app/ atrás
 * do gateway) e não precisa de regra de reescrita no servidor.
 */

import { ehAdmin, estaLogado } from "./sessao.js";
import { blocoVazio, h, limpar } from "./ui.js";

const ROTAS = [
  { padrao: "/", modulo: "./paginas/feed.js", titulo: "Oportunidades", grupo: "inicio" },
  { padrao: "/oportunidades/:id", modulo: "./paginas/oportunidade.js", titulo: "Oportunidade", grupo: "inicio" },
  { padrao: "/assistente", modulo: "./paginas/assistente.js", titulo: "Assistente", grupo: "assistente", exige: "login" },
  { padrao: "/salvos", modulo: "./paginas/salvos.js", titulo: "Salvos e lembretes", grupo: "salvos", exige: "login" },
  { padrao: "/avisos", modulo: "./paginas/avisos.js", titulo: "Avisos", grupo: "avisos", exige: "login" },
  { padrao: "/perfil", modulo: "./paginas/perfil.js", titulo: "Meu perfil", grupo: "conta", exige: "login" },
  { padrao: "/entrar", modulo: "./paginas/entrar.js", titulo: "Entrar", grupo: "conta" },
  { padrao: "/curadoria", modulo: "./paginas/curadoria.js", titulo: "Curadoria", grupo: "curadoria", exige: "admin" },
  { padrao: "/curadoria/:aba", modulo: "./paginas/curadoria.js", titulo: "Curadoria", grupo: "curadoria", exige: "admin" }
];

export function localizacaoAtual() {
  const bruto = location.hash.replace(/^#/, "") || "/";
  const [caminho, consultaTexto = ""] = bruto.split("?");
  return { caminho: caminho || "/", consulta: Object.fromEntries(new URLSearchParams(consultaTexto)) };
}

function casar(caminho) {
  const partes = caminho.split("/").filter(Boolean);
  for (const rota of ROTAS) {
    const modelo = rota.padrao.split("/").filter(Boolean);
    if (modelo.length !== partes.length) continue;
    const params = {};
    const confere = modelo.every((parte, i) => {
      if (parte.startsWith(":")) {
        params[parte.slice(1)] = decodeURIComponent(partes[i]);
        return true;
      }
      return parte === partes[i];
    });
    if (confere) return { rota, params };
  }
  return null;
}

export function iniciarRoteador({ raiz, aoNavegar }) {
  let limpezaAtual = null;
  let geracao = 0;

  async function resolver() {
    const minha = ++geracao;
    const { caminho, consulta } = localizacaoAtual();
    const alvo = casar(caminho);

    if (typeof limpezaAtual === "function") {
      try {
        limpezaAtual();
      } catch {
        /* a limpeza da página anterior não pode impedir a navegação */
      }
    }
    limpezaAtual = null;
    limpar(raiz);

    if (!alvo) {
      document.title = "Página não encontrada — ConectaU";
      raiz.append(
        blocoVazio("circle-alert", "Esta página não existe.", h("a", { classe: "botao", href: "#/" }, "Ir para as oportunidades"))
      );
      aoNavegar?.({ grupo: "inicio" });
      return;
    }

    const { rota, params } = alvo;
    if (rota.exige && !estaLogado()) {
      const volta = encodeURIComponent(location.hash.replace(/^#/, "") || "/");
      location.replace(`#/entrar?volta=${volta}`);
      return;
    }
    if (rota.exige === "admin" && !ehAdmin()) {
      document.title = "Acesso restrito — ConectaU";
      raiz.append(blocoVazio("shield-check", "A curadoria é exclusiva de administradores."));
      aoNavegar?.({ grupo: rota.grupo });
      return;
    }

    document.title = `${rota.titulo} — ConectaU`;
    aoNavegar?.({ grupo: rota.grupo });

    // Cada navegação escreve no seu próprio contêiner: se a resposta de uma página lenta chegar depois
    // de o usuário ter ido a outra, ela cai num contêiner já removido e não suja a tela atual.
    const pagina = h("div", { classe: "pagina" });
    raiz.append(pagina);

    try {
      const modulo = await import(rota.modulo);
      if (minha !== geracao) return; // o usuário já foi para outra página
      const limpeza = await modulo.renderizar(pagina, { params, consulta });
      if (minha !== geracao) {
        if (typeof limpeza === "function") limpeza();
        return;
      }
      limpezaAtual = limpeza;
    } catch (erro) {
      if (minha !== geracao) return;
      limpar(raiz);
      raiz.append(h("div", { classe: "bloco-erro", role: "alert" }, h("p", {}, `Não foi possível abrir esta página: ${erro.message}`)));
    }

    const principal = document.getElementById("principal");
    principal?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  window.addEventListener("hashchange", resolver);
  return { resolver };
}
