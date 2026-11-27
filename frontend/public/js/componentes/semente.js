import { h } from "../ui.js";

/**
 * A "semente" é a presença visual do assistente: uma forma orgânica que respira devagar quando está
 * parada e mais depressa enquanto o modelo trabalha. É o estado de carregamento do assistente,
 * não um enfeite: `data-estado` vai de "ocioso" a "pensando" e volta.
 */
export function criarSemente({ tamanho = 64, estado = "ocioso" } = {}) {
  const semente = h(
    "span",
    { classe: "semente", dataset: { estado }, "aria-hidden": "true" },
    h("span", { classe: "semente__a" }),
    h("span", { classe: "semente__b" }),
    h("span", { classe: "semente__c" })
  );
  // Pela CSSOM, e não pelo atributo style: a CSP da interface não permite estilo inline.
  semente.style.setProperty("--tam", `${tamanho}px`);
  return semente;
}

export function definirEstadoDaSemente(semente, estado) {
  semente.dataset.estado = estado;
}
