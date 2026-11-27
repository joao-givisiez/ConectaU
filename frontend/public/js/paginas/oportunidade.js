import { criarConversa } from "../componentes/conversa.js";
import { criarSemente } from "../componentes/semente.js";
import { ctx } from "../contexto.js";
import { estaLogado } from "../sessao.js";
import {
  CAMPI,
  CATEGORIAS,
  avisar,
  blocoErro,
  campo,
  comEspera,
  dataHora,
  esqueletos,
  h,
  icone,
  limpar,
  textoPrazo,
  urgencia
} from "../ui.js";

const ANTECEDENCIAS = [
  [1, "1 hora antes"],
  [6, "6 horas antes"],
  [24, "1 dia antes"],
  [48, "2 dias antes (padrão)"],
  [72, "3 dias antes"],
  [168, "1 semana antes"],
  [336, "2 semanas antes"],
  [720, "30 dias antes"]
];

const SUGESTOES = ["Quais são os requisitos?", "Quais são as datas e os prazos importantes?", "Como faço a inscrição?"];

/** Só abre links http(s): a URL vem do cadastro feito pela curadoria, mas nunca vira javascript: ou data:. */
function urlSegura(href) {
  return typeof href === "string" && /^https?:\/\//i.test(href);
}

function fato(rotulo, nomeIcone, valor) {
  if (!valor) return null;
  return h("div", { classe: "fato" }, h("dt", {}, icone(nomeIcone), rotulo), h("dd", {}, valor));
}

export async function renderizar(raiz, { params }) {
  limpar(raiz).append(h("a", { classe: "voltar", href: "#/" }, icone("arrow-left"), "Oportunidades"), esqueletos(1));
  const voltar = raiz.firstChild;

  async function carregar() {
    let o;
    try {
      o = await ctx.api.web.oportunidade(params.id);
    } catch (erro) {
      limpar(raiz).append(voltar, blocoErro(erro, carregar));
      return;
    }
    document.title = `${o.titulo} — ConectaU`;
    const links = o._links ?? {};
    const prazoPassou = new Date(o.prazoInscricao).getTime() <= Date.now();

    // ----- ações guiadas pelos links HATEOAS: o botão só existe se o link veio na resposta -----
    const acoes = h("div", { classe: "linha acoes" });
    const painelLembrete = h("form", { classe: "lembrete oculto", aoSubmit: criarLembrete });
    const seletor = h("select", { name: "antecedencia", valor: "48" }, ANTECEDENCIAS.map(([horas, texto]) => h("option", { value: String(horas) }, texto)));
    const botaoLembrete = h("button", { type: "submit", classe: "botao" }, icone("alarm-clock"), "Criar lembrete");
    painelLembrete.append(campo("Quando avisar", seletor), botaoLembrete);

    async function criarLembrete(evento) {
      evento.preventDefault();
      await comEspera(botaoLembrete, async () => {
        try {
          const horas = Number(seletor.value);
          const lembrete = await ctx.api.web.criarLembrete(o.id, horas);
          const rotulo = ANTECEDENCIAS.find(([valor]) => valor === horas)?.[1] ?? `${horas} horas antes`;
          avisar(`Lembrete criado: avisamos ${rotulo.replace(" (padrão)", "")} do prazo (${dataHora(lembrete.dispararEm)}).`);
          painelLembrete.classList.add("oculto");
        } catch (erro) {
          avisar(erro.message, { erro: true });
        }
      });
    }

    if (links.salvar && !o.salvo) {
      acoes.append(
        h("button", {
          type: "button",
          classe: "botao",
          aoClick: (e) =>
            comEspera(e.currentTarget, async () => {
              try {
                await ctx.api.web.salvar(o.id);
                avisar("Oportunidade salva.");
                await carregar();
              } catch (erro) {
                avisar(erro.message, { erro: true });
              }
            })
        }, icone("bookmark"), "Salvar")
      );
    }
    if (o.salvo && o.favoritoId) {
      acoes.append(
        h("button", {
          type: "button",
          classe: "botao botao--contorno",
          aoClick: (e) =>
            comEspera(e.currentTarget, async () => {
              try {
                await ctx.api.web.removerFavorito(o.favoritoId);
                avisar("Removida dos salvos.");
                await carregar();
              } catch (erro) {
                avisar(erro.message, { erro: true });
              }
            })
        }, icone("bookmark-minus"), "Remover dos salvos")
      );
    }
    if (links.lembrar) {
      acoes.append(
        h("button", { type: "button", classe: "botao botao--suave", "aria-expanded": "false", aoClick: (e) => {
          const aberto = painelLembrete.classList.toggle("oculto") === false;
          e.currentTarget.setAttribute("aria-expanded", String(aberto));
        } }, icone("alarm-clock"), "Lembrar do prazo")
      );
    }
    if (links.fonteOficial && urlSegura(links.fonteOficial.href)) {
      acoes.append(
        h("a", { classe: "botao botao--destaque", href: links.fonteOficial.href, target: "_blank", rel: "noopener noreferrer" },
          icone("external-link"), "Inscrever-se no canal oficial")
      );
    }
    if (!estaLogado()) {
      acoes.append(
        h("a", { classe: "botao botao--contorno", href: `#/entrar?volta=${encodeURIComponent(`/oportunidades/${o.id}`)}` },
          icone("log-in"), "Entrar para salvar, lembrar e perguntar")
      );
    }

    // ----- conteúdo -----
    const cartaoPrincipal = h(
      "article",
      { classe: "detalhe painel" },
      h(
        "div",
        { classe: "lista-chips" },
        h("span", { classe: "chip", dataset: { categoria: o.categoria } }, CATEGORIAS[o.categoria] ?? o.categoria),
        prazoPassou
          ? h("span", { classe: "chip chip--vazado" }, icone("clock"), "Inscrições encerradas")
          : h("span", { classe: `chip chip--${urgencia(o.prazoEmDias)}` }, icone("clock"), textoPrazo(o.prazoEmDias)),
        o.salvo && h("span", { classe: "chip chip--musgo" }, icone("bookmark-check"), "Salva")
      ),
      h("h1", { classe: "detalhe__titulo" }, o.titulo),
      h(
        "dl",
        { classe: "fatos" },
        fato("Inscrições até", "calendar", dataHora(o.prazoInscricao)),
        fato("Início", "clock", o.dataInicio ? dataHora(o.dataInicio) : null),
        fato("Campus", "map-pin", CAMPI[o.campus] ?? o.campus),
        fato("Categoria", "tag", CATEGORIAS[o.categoria] ?? o.categoria)
      ),
      o.descricao && h("div", { classe: "detalhe__descricao texto-longo" }, o.descricao),
      o.tags?.length > 0 && h("div", { classe: "lista-chips" }, o.tags.map((tag) => h("span", { classe: "chip chip--vazado" }, tag))),
      acoes,
      painelLembrete,
      h("p", { classe: "suave pequeno" }, "A inscrição é feita sempre no canal oficial. O ConectaU ajuda você a descobrir a oportunidade e a não perder o prazo.")
    );

    const secoes = [voltar, cartaoPrincipal];

    // ----- o agente, dentro do edital -----
    if (links.perguntar) {
      const conversa = criarConversa({
        api: ctx.api,
        oportunidade: { id: o.id, titulo: o.titulo },
        chave: `oportunidade-${o.id}`,
        sugestoes: SUGESTOES,
        placeholder: "Pergunte sobre este edital",
        apresentacao: h("p", { classe: "suave" }, "As respostas usam só o texto desta oportunidade e citam o trecho de onde vieram.")
      });
      secoes.push(
        h(
          "section",
          { classe: "painel painel--musgo assistente-edital", "aria-labelledby": "titulo-assistente-edital" },
          h("div", { classe: "assistente-edital__cabeca" }, criarSemente({ tamanho: 56 }), h("h2", { id: "titulo-assistente-edital" }, "Pergunte ao assistente sobre este edital")),
          conversa.elemento
        )
      );
    }

    limpar(raiz).append(...secoes);
  }

  await carregar();
}
