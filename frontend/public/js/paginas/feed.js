import { cartaoOportunidade } from "../componentes/cartao.js";
import { ctx } from "../contexto.js";
import { estaLogado } from "../sessao.js";
import { CAMPI, CATEGORIAS, blocoErro, blocoVazio, campo, esqueletos, h, icone, limpar, opcoes } from "../ui.js";

function irParaFiltros(valores) {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries(valores)) {
    if (valor && !(chave === "pagina" && valor === "1")) parametros.set(chave, valor);
  }
  const texto = parametros.toString();
  location.hash = texto ? `#/?${texto}` : "#/";
}

/** Feed personalizado (logado, sem filtros) ou busca pública com filtros. */
export async function renderizar(raiz, { consulta }) {
  const filtros = {
    busca: consulta.busca ?? "",
    campus: consulta.campus ?? "",
    categoria: consulta.categoria ?? "",
    pagina: consulta.pagina ?? "1"
  };
  const comFiltro = Boolean(filtros.busca || filtros.campus || filtros.categoria);
  const personalizado = estaLogado() && !comFiltro;

  const titulo = h("h1", {});
  if (comFiltro) titulo.append("Resultados da ", h("em", {}, "busca"));
  else if (personalizado) titulo.append("Para ", h("em", {}, "você"));
  else titulo.append("Oportunidades da ", h("em", {}, "UFLA"));

  const subtitulo = h(
    "p",
    { classe: "heroi__sub" },
    personalizado || comFiltro ? "" : "Eventos, atividades, bolsas, projetos e processos seletivos, reunidos num só lugar."
  );

  const campoBusca = h("input", { type: "search", name: "busca", placeholder: "Ex.: monitoria, docker, iniciação científica", valor: filtros.busca, autocomplete: "off" });
  const seletorCategoria = h("select", { name: "categoria", valor: filtros.categoria }, h("option", { value: "" }, "Todas as categorias"), opcoes(CATEGORIAS));
  const seletorCampus = h("select", { name: "campus", valor: filtros.campus }, h("option", { value: "" }, "Todos os campi"), opcoes(CAMPI));

  const formulario = h(
    "form",
    {
      classe: "busca",
      role: "search",
      aoSubmit: (evento) => {
        evento.preventDefault();
        irParaFiltros({ busca: campoBusca.value.trim(), categoria: seletorCategoria.value, campus: seletorCampus.value, pagina: "1" });
      }
    },
    campo("Buscar", campoBusca, { largo: true }),
    campo("Categoria", seletorCategoria),
    campo("Campus", seletorCampus),
    h(
      "div",
      { classe: "busca__acoes" },
      h("button", { type: "submit", classe: "botao" }, icone("search"), "Buscar"),
      comFiltro && h("a", { classe: "botao botao--suave", href: "#/" }, icone("x"), "Limpar filtros")
    )
  );

  const resultado = h("section", { classe: "resultado", "aria-live": "polite" });
  raiz.append(h("header", { classe: "heroi" }, titulo, subtitulo), formulario, resultado);

  async function carregar() {
    limpar(resultado).append(esqueletos(4));
    try {
      const dados = personalizado
        ? await ctx.api.web.feed({ pagina: filtros.pagina })
        : await ctx.api.web.oportunidades(filtros);

      if (personalizado && dados.filtro) {
        const partes = [];
        if (dados.filtro.campus) partes.push(`campus ${CAMPI[dados.filtro.campus] ?? dados.filtro.campus}`);
        if (dados.filtro.interesses?.length) partes.push(`interesses: ${dados.filtro.interesses.join(", ")}`);
        subtitulo.textContent = partes.length ? `Filtrado pelo seu perfil (${partes.join("; ")}).` : "";
      }

      limpar(resultado);
      if (dados.itens.length === 0) {
        resultado.append(
          blocoVazio(
            "sprout",
            comFiltro ? "Nenhuma oportunidade encontrada com esses filtros." : "Nenhuma oportunidade publicada ainda.",
            comFiltro && h("a", { classe: "botao botao--contorno botao--p", href: "#/" }, "Ver todas")
          )
        );
        return;
      }

      const totalDePaginas = Math.max(1, Math.ceil(dados.total / dados.limite));
      resultado.append(
        h("p", { classe: "resultado__total suave numero" }, `${dados.total} ${dados.total === 1 ? "oportunidade" : "oportunidades"}`),
        h("div", { classe: "grade-cartoes" }, dados.itens.map(cartaoOportunidade))
      );
      if (totalDePaginas > 1) {
        const atual = dados.pagina;
        resultado.append(
          h(
            "nav",
            { classe: "paginacao", "aria-label": "Páginas de resultados" },
            h("button", { type: "button", classe: "botao botao--contorno botao--p", disabled: atual <= 1, aoClick: () => irParaFiltros({ ...filtros, pagina: String(atual - 1) }) }, icone("chevron-left"), "Anterior"),
            h("span", { classe: "numero" }, `Página ${atual} de ${totalDePaginas}`),
            h("button", { type: "button", classe: "botao botao--contorno botao--p", disabled: atual >= totalDePaginas, aoClick: () => irParaFiltros({ ...filtros, pagina: String(atual + 1) }) }, "Próxima", icone("chevron-right"))
          )
        );
      }
    } catch (erro) {
      limpar(resultado).append(blocoErro(erro, carregar));
    }
  }

  await carregar();
}
