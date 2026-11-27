import { criarConversa } from "../componentes/conversa.js";
import { criarSemente } from "../componentes/semente.js";
import { ctx } from "../contexto.js";
import { h, icone } from "../ui.js";

const SUGESTOES = [
  "Quais bolsas estão abertas no campus de Lavras e quando fecham?",
  "Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada?",
  "O ConectaU faz a minha inscrição na oportunidade?"
];

function lista(nomeIcone, itens) {
  return h("ul", { classe: "ajuda__lista" }, itens.map((texto) => h("li", {}, icone(nomeIcone), h("span", {}, texto))));
}

/** O agente dentro do ConectaU: conversa geral sobre as oportunidades publicadas e sobre a plataforma. */
export async function renderizar(raiz) {
  const conversa = criarConversa({
    api: ctx.api,
    chave: "geral",
    sugestoes: SUGESTOES,
    placeholder: "Pergunte sobre oportunidades ou sobre o ConectaU",
    apresentacao: h(
      "p",
      { classe: "suave" },
      "Pergunte em português. Seja específico: inclua o campus, a categoria ou o nome da oportunidade."
    )
  });

  raiz.append(
    h(
      "header",
      { classe: "assistente__cabeca painel painel--musgo" },
      criarSemente({ tamanho: 96 }),
      h(
        "div",
        {},
        h("h1", {}, "Assistente do ", h("em", {}, "ConectaU")),
        h("p", {}, "Responde sobre as oportunidades publicadas e sobre como a plataforma funciona. Cada resposta indica as fontes usadas.")
      )
    ),
    h(
      "div",
      { classe: "assistente__corpo" },
      h("div", { classe: "assistente__conversa" }, conversa.elemento),
      h(
        "aside",
        { classe: "assistente__ajuda painel painel--aveia", "aria-label": "O que o assistente faz" },
        h("h2", {}, "O que ele faz"),
        lista("check", [
          "Procura entre as oportunidades publicadas por campus, categoria ou tema e informa os prazos.",
          "Explica o texto dos editais indexados e o funcionamento do ConectaU.",
          "Cita as fontes de cada resposta."
        ]),
        h("h2", {}, "O que ele não faz"),
        lista("x", [
          "Não faz inscrições: a inscrição é no canal oficial.",
          "Não conhece o seu perfil, os seus favoritos nem os seus lembretes.",
          "Não responde sobre assuntos fora de oportunidades acadêmicas e do ConectaU.",
          "Não substitui o edital: em caso de divergência, vale o texto oficial."
        ]),
        h("p", { classe: "pequeno suave" }, "O ConectaU limita o número de perguntas por minuto, porque cada uma consome o modelo de linguagem.")
      )
    )
  );
  conversa.focar();
}
