import { ctx } from "../contexto.js";
import { atualizarNome } from "../sessao.js";
import { CAMPI, avisar, blocoErro, campo, comEspera, esqueletos, h, icone, limpar, listaDeTags, opcoes } from "../ui.js";

export async function renderizar(raiz) {
  const area = h("div", {});
  raiz.append(h("header", { classe: "heroi" }, h("h1", {}, "Meu ", h("em", {}, "perfil"))), area);

  async function carregar() {
    limpar(area).append(esqueletos(1));
    let perfil;
    try {
      perfil = await ctx.api.web.perfil();
    } catch (erro) {
      limpar(area).append(blocoErro(erro, carregar));
      return;
    }

    const nome = h("input", { name: "nome", required: true, maxlength: 120, valor: perfil.nome, autocomplete: "name" });
    const curso = h("input", { name: "curso", required: true, maxlength: 120, valor: perfil.curso });
    const campus = h("select", { name: "campus", valor: perfil.campus }, opcoes(CAMPI));
    const interesses = h("input", { name: "interesses", valor: (perfil.interesses ?? []).join(", "), placeholder: "tecnologia, pesquisa" });
    const email = h("input", { name: "email", type: "email", valor: perfil.email, disabled: true, autocomplete: "username" });
    const salvar = h("button", { type: "submit", classe: "botao" }, icone("check"), "Salvar alterações");

    const formulario = h(
      "form",
      {
        classe: "formulario painel",
        aoSubmit: async (evento) => {
          evento.preventDefault();
          await comEspera(salvar, async () => {
            try {
              const atualizado = await ctx.api.web.atualizarPerfil({
                nome: nome.value.trim(),
                curso: curso.value.trim(),
                campus: campus.value,
                interesses: listaDeTags(interesses.value)
              });
              atualizarNome(atualizado.nome);
              avisar("Perfil atualizado. O feed passa a usar o novo campus e os novos interesses.");
            } catch (erro) {
              avisar(erro.message, { erro: true });
            }
          });
        }
      },
      h(
        "div",
        { classe: "grade-campos" },
        campo("Nome", nome),
        campo("E-mail", email, { ajuda: "O e-mail não pode ser alterado." }),
        campo("Curso", curso),
        campo("Campus", campus),
        campo("Interesses", interesses, { largo: true, ajuda: "Separe por vírgula. O feed mostra as oportunidades com essas tags no seu campus." })
      ),
      h("div", { classe: "formulario__acoes" }, salvar)
    );
    limpar(area).append(formulario);
  }

  await carregar();
}
