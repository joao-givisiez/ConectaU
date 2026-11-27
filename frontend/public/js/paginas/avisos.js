import { ctx } from "../contexto.js";
import { avisar, blocoErro, blocoVazio, dataHora, esqueletos, h, icone, limpar } from "../ui.js";

const TIPOS = {
  PRAZO_PROXIMO: { rotulo: "Prazo próximo", icone: "alarm-clock" },
  OPORTUNIDADE_ALTERADA: { rotulo: "Oportunidade alterada", icone: "pencil" },
  OPORTUNIDADE_ENCERRADA: { rotulo: "Oportunidade encerrada", icone: "archive" }
};

export async function renderizar(raiz, { consulta }) {
  const pagina = Number(consulta.pagina ?? 1) || 1;
  const area = h("section", { classe: "pilha", "aria-live": "polite" });
  raiz.append(h("header", { classe: "heroi" }, h("h1", {}, "Seus ", h("em", {}, "avisos"))), area);

  async function carregar() {
    limpar(area).append(esqueletos(2));
    let dados;
    try {
      dados = await ctx.api.web.notificacoes({ pagina, limite: 20 });
    } catch (erro) {
      limpar(area).append(blocoErro(erro, carregar));
      return;
    }
    limpar(area);
    if (dados.itens.length === 0) {
      area.append(blocoVazio("bell", "Nenhum aviso por enquanto. Eles aparecem quando um lembrete dispara ou uma oportunidade salva muda ou é encerrada."));
      return;
    }

    const naoLidas = dados.itens.filter((n) => !n.lida);
    if (naoLidas.length > 0) {
      area.append(
        h(
          "div",
          { classe: "linha linha--entre" },
          h("span", { classe: "suave numero" }, `${naoLidas.length} ${naoLidas.length === 1 ? "não lido" : "não lidos"} nesta página`),
          h(
            "button",
            {
              type: "button",
              classe: "botao botao--contorno botao--p",
              aoClick: async (evento) => {
                evento.currentTarget.disabled = true;
                try {
                  await Promise.all(naoLidas.map((n) => ctx.api.web.marcarComoLida(n.id)));
                  avisar("Avisos marcados como lidos.");
                } catch (erro) {
                  avisar(erro.message, { erro: true });
                }
                await ctx.atualizarAvisos();
                await carregar();
              }
            },
            icone("check"),
            "Marcar todos como lidos"
          )
        )
      );
    }

    area.append(
      h(
        "ul",
        { classe: "pilha" },
        dados.itens.map((n) => {
          const tipo = TIPOS[n.tipo] ?? { rotulo: n.tipo, icone: "bell" };
          return h(
            "li",
            { classe: `cartao aviso-item${n.lida ? "" : " aviso-item--novo"}` },
            h(
              "div",
              { classe: "lista-chips" },
              !n.lida && h("span", { classe: "chip chip--urgente" }, "Novo"),
              h("span", { classe: "chip" }, icone(tipo.icone), tipo.rotulo),
              h("span", { classe: "chip chip--vazado numero" }, dataHora(n.criadaEm))
            ),
            h("h3", {}, n.titulo),
            h("p", {}, n.mensagem),
            h(
              "div",
              { classe: "linha" },
              n.oportunidadeId && h("a", { classe: "botao botao--suave botao--p", href: `#/oportunidades/${n.oportunidadeId}` }, icone("file-text"), "Ver oportunidade"),
              !n.lida &&
                h(
                  "button",
                  {
                    type: "button",
                    classe: "botao botao--contorno botao--p",
                    aoClick: async (evento) => {
                      evento.currentTarget.disabled = true;
                      try {
                        await ctx.api.web.marcarComoLida(n.id);
                        await ctx.atualizarAvisos();
                        await carregar();
                      } catch (erro) {
                        evento.currentTarget.disabled = false;
                        avisar(erro.message, { erro: true });
                      }
                    }
                  },
                  icone("check"),
                  "Marcar como lido"
                )
            )
          );
        })
      )
    );

    const totalDePaginas = Math.max(1, Math.ceil(dados.total / dados.limite));
    if (totalDePaginas > 1) {
      area.append(
        h(
          "nav",
          { classe: "paginacao", "aria-label": "Páginas de avisos" },
          h("a", { classe: `botao botao--contorno botao--p${pagina <= 1 ? " oculto" : ""}`, href: `#/avisos?pagina=${pagina - 1}` }, icone("chevron-left"), "Anterior"),
          h("span", { classe: "numero" }, `Página ${pagina} de ${totalDePaginas}`),
          h("a", { classe: `botao botao--contorno botao--p${pagina >= totalDePaginas ? " oculto" : ""}`, href: `#/avisos?pagina=${pagina + 1}` }, "Próxima", icone("chevron-right"))
        )
      );
    }
  }

  await carregar();
}
