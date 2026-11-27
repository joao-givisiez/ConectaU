import { ctx } from "../contexto.js";
import { avisar, blocoErro, blocoVazio, dataHora, esqueletos, h, icone, limpar } from "../ui.js";

const ESTADO_DO_LEMBRETE = { AGENDADO: "Agendado", DISPARADO: "Disparado", CANCELADO: "Cancelado" };

/** 1 hora, 6 horas, 1 dia, 2 dias... */
function antecedenciaTexto(horas) {
  if (horas % 24 === 0) {
    const dias = horas / 24;
    return dias === 1 ? "1 dia" : `${dias} dias`;
  }
  return horas === 1 ? "1 hora" : `${horas} horas`;
}

export async function renderizar(raiz) {
  const areaFavoritos = h("section", { classe: "secao", "aria-labelledby": "titulo-salvos" });
  const areaLembretes = h("section", { classe: "secao", "aria-labelledby": "titulo-lembretes" });
  raiz.append(
    h("header", { classe: "heroi" }, h("h1", {}, "Salvos e ", h("em", {}, "lembretes"))),
    h("div", { classe: "pilha pilha--g" }, areaFavoritos, areaLembretes)
  );

  async function carregar() {
    limpar(areaFavoritos).append(h("h2", { id: "titulo-salvos" }, "Oportunidades salvas"), esqueletos(2));
    limpar(areaLembretes).append(h("h2", { id: "titulo-lembretes" }, "Lembretes de prazo"), esqueletos(1));

    const [favoritos, lembretes] = await Promise.allSettled([ctx.api.web.favoritos(), ctx.api.web.lembretes()]);

    // Os lembretes só trazem o id da oportunidade: o título vem dos salvos ou, na falta, do detalhe.
    const titulos = new Map();
    if (favoritos.status === "fulfilled") {
      for (const f of favoritos.value.itens) if (f.oportunidade?.titulo) titulos.set(f.oportunidadeId, f.oportunidade.titulo);
    }
    if (lembretes.status === "fulfilled") {
      const faltam = [...new Set(lembretes.value.itens.map((l) => l.oportunidadeId))].filter((id) => !titulos.has(id));
      await Promise.all(
        faltam.map((id) =>
          ctx.api.web.oportunidade(id).then(
            (o) => titulos.set(id, o.titulo),
            () => {
              /* encerrada ou removida: o texto padrão cobre */
            }
          )
        )
      );
    }

    desenharFavoritos(favoritos);
    desenharLembretes(lembretes, titulos);
  }

  function desenharFavoritos(resultado) {
    limpar(areaFavoritos).append(h("h2", { id: "titulo-salvos" }, "Oportunidades salvas"));
    if (resultado.status === "rejected") {
      areaFavoritos.append(blocoErro(resultado.reason, carregar));
      return;
    }
    const { itens } = resultado.value;
    if (itens.length === 0) {
      areaFavoritos.append(
        blocoVazio("bookmark", "Você ainda não salvou nenhuma oportunidade.", h("a", { classe: "botao botao--contorno botao--p", href: "#/" }, "Ver oportunidades"))
      );
      return;
    }
    areaFavoritos.append(
      h(
        "ul",
        { classe: "pilha" },
        itens.map((f) =>
          h(
            "li",
            { classe: "cartao item" },
            h(
              "div",
              { classe: "item__texto" },
              h("h3", {}, h("a", { href: `#/oportunidades/${f.oportunidadeId}` }, f.oportunidade?.titulo ?? "Oportunidade")),
              h(
                "div",
                { classe: "lista-chips" },
                f.oportunidade?.status === "ENCERRADA" && h("span", { classe: "chip chip--vazado" }, "Encerrada"),
                f.oportunidade?.prazoInscricao && h("span", { classe: "chip" }, icone("calendar"), `Inscrições até ${dataHora(f.oportunidade.prazoInscricao)}`)
              )
            ),
            h(
              "button",
              {
                type: "button",
                classe: "botao botao--contorno botao--p",
                "aria-label": `Remover ${f.oportunidade?.titulo ?? "a oportunidade"} dos salvos`,
                aoClick: async (evento) => {
                  evento.currentTarget.disabled = true;
                  try {
                    await ctx.api.web.removerFavorito(f.id);
                    avisar("Removida dos salvos.");
                    await carregar();
                  } catch (erro) {
                    evento.currentTarget.disabled = false;
                    avisar(erro.message, { erro: true });
                  }
                }
              },
              icone("bookmark-minus"),
              "Remover"
            )
          )
        )
      )
    );
  }

  function desenharLembretes(resultado, titulos) {
    limpar(areaLembretes).append(h("h2", { id: "titulo-lembretes" }, "Lembretes de prazo"));
    if (resultado.status === "rejected") {
      areaLembretes.append(blocoErro(resultado.reason, carregar));
      return;
    }
    const { itens } = resultado.value;
    if (itens.length === 0) {
      areaLembretes.append(blocoVazio("alarm-clock", "Nenhum lembrete criado. Abra uma oportunidade e escolha Lembrar do prazo."));
      return;
    }
    areaLembretes.append(
      h(
        "ul",
        { classe: "pilha" },
        itens.map((l) => {
          const titulo = titulos.get(l.oportunidadeId) ?? "Oportunidade encerrada ou indisponível";
          return h(
            "li",
            { classe: "cartao item" },
            h(
              "div",
              { classe: "item__texto" },
              h("h3", {}, titulos.has(l.oportunidadeId) ? h("a", { href: `#/oportunidades/${l.oportunidadeId}` }, titulo) : titulo),
              h(
                "div",
                { classe: "lista-chips" },
                h("span", { classe: "chip", dataset: { estado: l.estado } }, ESTADO_DO_LEMBRETE[l.estado] ?? l.estado),
                h("span", { classe: "chip chip--vazado" }, icone("alarm-clock"), `Avisa ${antecedenciaTexto(l.antecedenciaHoras)} antes`),
                h("span", { classe: "chip chip--vazado" }, l.estado === "DISPARADO" ? `Disparou em ${dataHora(l.dispararEm)}` : `Dispara em ${dataHora(l.dispararEm)}`)
              )
            ),
            h(
              "button",
              {
                type: "button",
                classe: "botao botao--contorno botao--p",
                "aria-label": `Excluir o lembrete de ${titulo}`,
                aoClick: async (evento) => {
                  evento.currentTarget.disabled = true;
                  try {
                    await ctx.api.web.removerLembrete(l.id);
                    avisar("Lembrete excluído.");
                    await carregar();
                  } catch (erro) {
                    evento.currentTarget.disabled = false;
                    avisar(erro.message, { erro: true });
                  }
                }
              },
              icone("trash-2"),
              "Excluir"
            )
          );
        })
      )
    );
  }

  await carregar();
}
