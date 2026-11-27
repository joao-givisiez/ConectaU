import { ctx } from "../contexto.js";
import { estaLogado, iniciarSessao } from "../sessao.js";
import { CAMPI, avisar, campo, comEspera, h, icone, listaDeTags, opcoes } from "../ui.js";

/** Só volta para rotas internas: o parâmetro vem da URL e não pode virar um redirecionamento externo. */
function destinoSeguro(volta, papel) {
  if (typeof volta === "string" && volta.startsWith("/") && !volta.startsWith("//")) return volta;
  return papel === "ADMIN" ? "/curadoria" : "/";
}

export async function renderizar(raiz, { consulta }) {
  if (estaLogado()) {
    ctx.ir("/");
    return;
  }

  async function abrirSessao(email, senha) {
    const sessao = await ctx.api.auth.entrar({ email, senha });
    iniciarSessao(sessao);
    avisar("Bem-vindo(a) ao ConectaU.");
    ctx.ir(destinoSeguro(consulta.volta, sessao.papel));
  }

  // ----- entrar -----
  const emailEntrada = h("input", { name: "email", type: "email", required: true, autocomplete: "username" });
  const senhaEntrada = h("input", { name: "senha", type: "password", required: true, autocomplete: "current-password" });
  const botaoEntrar = h("button", { type: "submit", classe: "botao botao--bloco" }, icone("log-in"), "Entrar");
  const erroEntrada = h("p", { classe: "erro-campo oculto", role: "alert" });

  const formEntrar = h(
    "form",
    {
      classe: "formulario painel",
      "aria-labelledby": "titulo-entrar",
      aoSubmit: async (evento) => {
        evento.preventDefault();
        erroEntrada.classList.add("oculto");
        await comEspera(botaoEntrar, async () => {
          try {
            await abrirSessao(emailEntrada.value.trim(), senhaEntrada.value);
          } catch (erro) {
            erroEntrada.textContent = erro.message;
            erroEntrada.classList.remove("oculto");
          }
        });
      }
    },
    h("h2", { id: "titulo-entrar" }, "Entrar"),
    campo("E-mail", emailEntrada),
    campo("Senha", senhaEntrada),
    erroEntrada,
    botaoEntrar
  );

  // ----- criar conta -----
  const nome = h("input", { name: "nome", required: true, maxlength: 120, autocomplete: "name" });
  const email = h("input", { name: "email", type: "email", required: true, autocomplete: "email" });
  const senha = h("input", { name: "senha", type: "password", required: true, minlength: 8, autocomplete: "new-password" });
  const curso = h("input", { name: "curso", required: true, maxlength: 120 });
  const campus = h("select", { name: "campus", valor: "LAVRAS" }, opcoes(CAMPI));
  const interesses = h("input", { name: "interesses", placeholder: "tecnologia, pesquisa" });
  const botaoCadastrar = h("button", { type: "submit", classe: "botao botao--destaque botao--bloco" }, icone("plus"), "Criar conta");
  const erroCadastro = h("p", { classe: "erro-campo oculto", role: "alert" });

  const formCadastro = h(
    "form",
    {
      classe: "formulario painel",
      "aria-labelledby": "titulo-cadastro",
      aoSubmit: async (evento) => {
        evento.preventDefault();
        erroCadastro.classList.add("oculto");
        await comEspera(botaoCadastrar, async () => {
          try {
            await ctx.api.auth.cadastrar({
              nome: nome.value.trim(),
              email: email.value.trim(),
              senha: senha.value,
              curso: curso.value.trim(),
              campus: campus.value,
              interesses: listaDeTags(interesses.value)
            });
            await abrirSessao(email.value.trim(), senha.value);
          } catch (erro) {
            erroCadastro.textContent = erro.message;
            erroCadastro.classList.remove("oculto");
          }
        });
      }
    },
    h("h2", { id: "titulo-cadastro" }, "Criar conta"),
    h(
      "div",
      { classe: "grade-campos" },
      campo("Nome", nome),
      campo("E-mail", email),
      campo("Senha", senha, { ajuda: "No mínimo 8 caracteres." }),
      campo("Curso", curso),
      campo("Campus", campus),
      campo("Interesses", interesses, { ajuda: "Separe por vírgula." })
    ),
    erroCadastro,
    botaoCadastrar
  );

  raiz.append(
    h("header", { classe: "heroi" }, h("h1", {}, "Entre no ", h("em", {}, "ConectaU"))),
    h("div", { classe: "entrar__colunas" }, formEntrar, formCadastro)
  );
  emailEntrada.focus();
}
