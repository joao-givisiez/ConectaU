import { CAMPI, CATEGORIAS, dataDoDia, h, icone, textoPrazo, urgencia } from "../ui.js";

/**
 * Cartão compacto de oportunidade (formato que o BFF Web entrega no feed e na busca).
 * O título é o link do cartão inteiro, para o clique e o leitor de tela encontrarem um único destino.
 */
export function cartaoOportunidade(o) {
  return h(
    "article",
    { classe: "cartao cartao--oportunidade" },
    h(
      "div",
      { classe: "cartao__topo" },
      h("span", { classe: "chip", dataset: { categoria: o.categoria } }, CATEGORIAS[o.categoria] ?? o.categoria),
      o.salvo && h("span", { classe: "cartao__salvo" }, icone("bookmark-check", { rotulo: "Você salvou esta oportunidade" }))
    ),
    h("h3", {}, h("a", { classe: "cartao__link", href: `#/oportunidades/${o.id}` }, o.titulo)),
    h(
      "ul",
      { classe: "meta" },
      o.quando && h("li", {}, icone("calendar"), dataDoDia(o.quando)),
      h("li", {}, icone("map-pin"), CAMPI[o.campus] ?? o.campus)
    ),
    h("span", { classe: `chip chip--${urgencia(o.prazoEmDias)}` }, icone("clock"), textoPrazo(o.prazoEmDias))
  );
}
