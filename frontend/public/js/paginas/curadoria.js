/**
 * Curadoria (ADMIN). Tudo passa pelo BFF Admin (/admin/**), que o gateway só abre para o papel ADMIN.
 * A publicação dispara a SAGA do serviço Oportunidades; aqui ela é acompanhada passo a passo.
 */

import { ctx } from "../contexto.js";
import {
  CAMPI,
  CATEGORIAS,
  STATUS,
  avisar,
  blocoErro,
  blocoVazio,
  campo,
  comEspera,
  confirmar,
  dataHora,
  deCampoDataHora,
  esqueletos,
  h,
  icone,
  limpar,
  listaDeTags,
  opcoes,
  paraCampoDataHora
} from "../ui.js";

const ABAS = [
  { id: "fila", rotulo: "Fila" },
  { id: "RASCUNHO", rotulo: "Rascunhos" },
  { id: "PUBLICANDO", rotulo: "Publicando" },
  { id: "PUBLICADA", rotulo: "Publicadas" },
  { id: "ENCERRADA", rotulo: "Encerradas" },
  { id: "fontes", rotulo: "Fontes" }
];

const PASSOS_DA_SAGA = {
  CONSUMIR_CANDIDATO: "Marcar o candidato como usado (Coleta)",
  INDEXAR_ASSISTENTE: "Indexar o texto no Assistente",
  CONCLUIR_PUBLICACAO: "Publicar no catálogo"
};
const ROTULO_DO_ESTADO = {
  INICIADA: "Iniciada",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  COMPENSANDO: "Compensando",
  COMPENSADA: "Compensada",
  FALHA_COMPENSACAO: "Falha na compensação",
  PENDENTE: "Pendente",
  OK: "Concluído",
  FALHA: "Falha",
  COMPENSADO: "Compensado",
  CONSUMIDO: "Consumido",
  DESCARTADO: "Descartado",
  DUPLICADO: "Duplicado"
};
const rotuloDoEstado = (estado) => ROTULO_DO_ESTADO[estado] ?? estado;
const ESTADOS_FINAIS_DA_SAGA = ["CONCLUIDA", "COMPENSADA", "FALHA_COMPENSACAO"];
const DOIS_DIAS = 2 * 24 * 3600 * 1000;

export async function renderizar(raiz, { params }) {
  const aba = ABAS.some((a) => a.id === params.aba) ? params.aba : "fila";
  let ativo = true;
  const area = h("section", { classe: "pilha pilha--g", "aria-live": "polite" });

  raiz.append(
    h("header", { classe: "heroi" }, h("h1", {}, h("em", {}, "Curadoria"))),
    h(
      "nav",
      { classe: "abas", "aria-label": "Seções da curadoria" },
      ABAS.map((a) => h("a", { classe: "aba", href: `#/curadoria/${a.id}`, ...(a.id === aba ? { "aria-current": "page" } : {}) }, a.rotulo))
    ),
    area
  );

  const recarregar = () => (aba === "fila" ? desenharFila() : aba === "fontes" ? desenharFontes() : desenharOportunidades(aba));

  // ---------- formulário de oportunidade (criar a partir de um candidato ou editar) ----------

  function formularioOportunidade({ valores, candidatoId, oportunidadeId, aoConcluir }) {
    const titulo = h("input", { name: "titulo", required: true, maxlength: 300, valor: valores.titulo ?? "" });
    const descricao = h("textarea", { name: "descricao", rows: 5, valor: valores.descricao ?? "" });
    const categoria = h("select", { name: "categoria", valor: valores.categoria ?? "EVENTO" }, opcoes(CATEGORIAS));
    const campus = h("select", { name: "campus", valor: valores.campus ?? "LAVRAS" }, opcoes(CAMPI));
    const inicio = h("input", { name: "dataInicio", type: "datetime-local", valor: paraCampoDataHora(valores.dataInicio) });
    const prazo = h("input", { name: "prazoInscricao", type: "datetime-local", required: true, valor: paraCampoDataHora(valores.prazoInscricao) });
    const fonte = h("input", { name: "fonteUrl", type: "url", required: true, valor: valores.fonteUrl ?? "" });
    const tags = h("input", { name: "tags", valor: (valores.tags ?? []).join(", "), placeholder: "tecnologia, containers" });
    const salvar = h("button", { type: "submit", classe: "botao" }, icone("check"), oportunidadeId ? "Salvar alterações" : "Salvar como rascunho");

    return h(
      "form",
      {
        classe: "formulario formulario--interno",
        aoSubmit: async (evento) => {
          evento.preventDefault();
          await comEspera(salvar, async () => {
            const corpo = {
              titulo: titulo.value.trim(),
              descricao: descricao.value.trim() || undefined,
              categoria: categoria.value,
              campus: campus.value,
              dataInicio: deCampoDataHora(inicio.value),
              prazoInscricao: deCampoDataHora(prazo.value),
              fonteUrl: fonte.value.trim(),
              tags: listaDeTags(tags.value)
            };
            try {
              if (oportunidadeId) await ctx.api.admin.editarOportunidade(oportunidadeId, corpo);
              else await ctx.api.admin.criarOportunidade({ candidatoId, ...corpo });
              avisar(oportunidadeId ? "Oportunidade atualizada." : "Rascunho criado. Publique pela aba Rascunhos.");
              await aoConcluir();
            } catch (erro) {
              avisar(erro.message, { erro: true });
            }
          });
        }
      },
      h(
        "div",
        { classe: "grade-campos" },
        campo("Título", titulo, { largo: true }),
        campo("Descrição", descricao, { largo: true }),
        campo("Categoria", categoria),
        campo("Campus", campus),
        campo("Início", inicio),
        campo("Prazo de inscrição", prazo),
        campo("Canal oficial (URL)", fonte, { largo: true }),
        campo("Tags", tags, { largo: true, ajuda: "Separe por vírgula." })
      ),
      h("div", { classe: "formulario__acoes" }, salvar)
    );
  }

  // ---------- Fila de candidatos ----------

  async function desenharFila() {
    limpar(area).append(esqueletos(2));
    let candidatos;
    let fontes;
    try {
      [candidatos, fontes] = await Promise.all([ctx.api.admin.candidatos({ status: "PENDENTE" }), ctx.api.admin.fontes()]);
    } catch (erro) {
      limpar(area).append(blocoErro(erro, desenharFila));
      return;
    }
    if (!ativo) return;

    const areaManual = h("div", {});
    const botoesDeColeta = fontes.itens.map((f) =>
      h(
        "button",
        {
          type: "button",
          classe: "botao botao--suave botao--p",
          aoClick: (evento) =>
            comEspera(evento.currentTarget, async () => {
              try {
                const execucao = await ctx.api.admin.executarColeta(f.id);
                avisar(`Coleta ${execucao.estado}: ${execucao.itensNovos} novo(s), ${execucao.itensDuplicados} duplicado(s).`);
                await desenharFila();
              } catch (erro) {
                avisar(erro.message, { erro: true });
              }
            })
        },
        icone("play"),
        `Executar coleta: ${f.nome}`
      )
    );

    const painelAcoes = h(
      "div",
      { classe: "painel pilha" },
      h("div", { classe: "linha linha--entre" }, h("h2", {}, "Fila de curadoria"), h("span", { classe: "chip chip--musgo numero" }, `${candidatos.total} pendente(s)`)),
      h(
        "div",
        { classe: "linha" },
        botoesDeColeta,
        h(
          "button",
          {
            type: "button",
            classe: "botao botao--contorno botao--p",
            aoClick: () => {
              if (areaManual.childElementCount > 0) limpar(areaManual);
              else areaManual.append(formularioManual());
            }
          },
          icone("plus"),
          "Cadastro manual"
        )
      ),
      areaManual
    );

    function formularioManual() {
      const titulo = h("input", { name: "titulo", required: true, maxlength: 300 });
      const descricao = h("textarea", { name: "descricao", rows: 3 });
      const data = h("input", { name: "data", type: "datetime-local" });
      const solicitante = h("input", { name: "solicitante", maxlength: 200 });
      const url = h("input", { name: "urlOrigem", type: "url", required: true });
      const salvar = h("button", { type: "submit", classe: "botao" }, icone("check"), "Registrar candidato");
      return h(
        "form",
        {
          classe: "formulario formulario--interno",
          aoSubmit: async (evento) => {
            evento.preventDefault();
            await comEspera(salvar, async () => {
              try {
                await ctx.api.admin.registrarCandidato({
                  titulo: titulo.value.trim(),
                  descricao: descricao.value.trim() || undefined,
                  data: deCampoDataHora(data.value),
                  solicitante: solicitante.value.trim() || undefined,
                  urlOrigem: url.value.trim()
                });
                avisar("Candidato registrado na fila.");
                await desenharFila();
              } catch (erro) {
                avisar(erro.message, { erro: true });
              }
            });
          }
        },
        h(
          "div",
          { classe: "grade-campos" },
          campo("Título", titulo, { largo: true }),
          campo("Descrição", descricao, { largo: true }),
          campo("Data", data),
          campo("Quem pediu a divulgação", solicitante),
          campo("Canal oficial (URL)", url, { largo: true })
        ),
        h("div", { classe: "formulario__acoes" }, salvar)
      );
    }

    limpar(area).append(painelAcoes);
    if (candidatos.itens.length === 0) {
      area.append(blocoVazio("inbox", "Nenhum candidato pendente. Execute uma coleta ou registre um manualmente."));
      return;
    }

    for (const c of candidatos.itens) {
      const formulario = h("div", {});
      const mudarStatus = (status, mensagem) => async (evento) => {
        await comEspera(evento.currentTarget, async () => {
          try {
            await ctx.api.admin.atualizarCandidato(c.id, status);
            avisar(mensagem);
            await desenharFila();
          } catch (erro) {
            avisar(erro.message, { erro: true });
          }
        });
      };
      area.append(
        h(
          "article",
          { classe: "cartao pilha" },
          h(
            "div",
            { classe: "lista-chips" },
            h("span", { classe: "chip" }, c.origem === "MANUAL" ? "Cadastro manual" : "Coleta automática"),
            c.dataExtraida && h("span", { classe: "chip chip--vazado" }, icone("calendar"), dataHora(c.dataExtraida)),
            h("span", { classe: `chip ${c.scoreDuplicidade >= 0.5 ? "chip--atencao" : "chip--vazado"} numero` }, `Semelhança com outros: ${Math.round(c.scoreDuplicidade * 100)}%`)
          ),
          h("h3", {}, c.tituloExtraido),
          c.descricaoExtraida && h("p", { classe: "texto-longo suave" }, c.descricaoExtraida),
          h(
            "p",
            { classe: "pequeno suave" },
            `Coletado em ${dataHora(c.coletadoEm)}`,
            c.solicitante ? ` · pedido por ${c.solicitante}` : "",
            " · ",
            h("a", { href: c.urlOrigem, target: "_blank", rel: "noopener noreferrer" }, "canal de origem")
          ),
          h(
            "div",
            { classe: "linha" },
            h(
              "button",
              {
                type: "button",
                classe: "botao botao--p",
                aoClick: () => {
                  if (formulario.childElementCount > 0) return limpar(formulario);
                  formulario.append(
                    formularioOportunidade({
                      candidatoId: c.id,
                      valores: {
                        titulo: c.tituloExtraido,
                        descricao: c.descricaoExtraida,
                        fonteUrl: c.urlOrigem,
                        dataInicio: c.dataExtraida,
                        prazoInscricao: c.dataExtraida ? new Date(new Date(c.dataExtraida).getTime() - DOIS_DIAS).toISOString() : undefined
                      },
                      aoConcluir: () => limpar(formulario)
                    })
                  );
                }
              },
              icone("file-text"),
              "Criar oportunidade"
            ),
            h("button", { type: "button", classe: "botao botao--contorno botao--p", aoClick: mudarStatus("DESCARTADO", "Candidato descartado.") }, icone("x"), "Descartar"),
            h("button", { type: "button", classe: "botao botao--contorno botao--p", aoClick: mudarStatus("DUPLICADO", "Candidato marcado como duplicado.") }, icone("copy"), "Marcar como duplicado")
          ),
          formulario
        )
      );
    }
  }

  // ---------- Oportunidades por status ----------

  function listaDePassos(saga) {
    return h(
      "div",
      { classe: "saga" },
      h(
        "p",
        { classe: "linha" },
        h("strong", {}, "Publicação (SAGA)"),
        h("span", { classe: "chip", dataset: { estado: saga.estado } }, rotuloDoEstado(saga.estado)),
        h("span", { classe: "codigo" }, saga.sagaId ?? saga.id)
      ),
      saga.erro && h("p", { classe: "pequeno suave" }, `Motivo: ${saga.erro}`),
      h(
        "ol",
        { classe: "passos" },
        (saga.passos ?? []).map((p) =>
          h(
            "li",
            {},
            h("span", {}, PASSOS_DA_SAGA[p.passo] ?? p.passo),
            h("span", { classe: "chip", dataset: { estado: p.estado } }, rotuloDoEstado(p.estado)),
            p.detalhe && h("span", { classe: "pequeno suave" }, p.detalhe)
          )
        )
      )
    );
  }

  function registroCompleto(r) {
    const origem = r.origem ?? {};
    return h(
      "div",
      { classe: "registro pilha" },
      h(
        "dl",
        { classe: "fatos fatos--denso" },
        h("div", { classe: "fato" }, h("dt", {}, "Origem"), h("dd", {}, origem.indisponivel ? "Indisponível (a Coleta não respondeu)" : origem.tipo === "MANUAL" ? "Cadastro manual" : "Coleta automática")),
        origem.solicitante && h("div", { classe: "fato" }, h("dt", {}, "Pedido por"), h("dd", {}, origem.solicitante)),
        origem.coletadoEm && h("div", { classe: "fato" }, h("dt", {}, "Coletado em"), h("dd", {}, dataHora(origem.coletadoEm))),
        origem.scoreDuplicidade !== undefined && h("div", { classe: "fato" }, h("dt", {}, "Semelhança com outros"), h("dd", {}, `${Math.round(origem.scoreDuplicidade * 100)}%`)),
        origem.statusCandidato && h("div", { classe: "fato" }, h("dt", {}, "Candidato"), h("dd", {}, rotuloDoEstado(origem.statusCandidato))),
        r.publicadaEm && h("div", { classe: "fato" }, h("dt", {}, "Publicada em"), h("dd", {}, dataHora(r.publicadaEm))),
        h("div", { classe: "fato" }, h("dt", {}, "Versão"), h("dd", {}, String(r.versao)))
      ),
      r.saga ? listaDePassos(r.saga) : h("p", { classe: "pequeno suave" }, "Esta oportunidade ainda não foi publicada."),
      h("details", {}, h("summary", {}, "Registro em JSON"), h("pre", { classe: "codigo" }, JSON.stringify(r, null, 2)))
    );
  }

  /** Acompanha a SAGA até um estado final. Para sozinho se a página for fechada (ativo = false). */
  async function acompanharSaga(sagaId, alvo) {
    while (ativo) {
      try {
        const saga = await ctx.api.admin.publicacao(sagaId);
        if (!ativo) return;
        limpar(alvo).append(listaDePassos(saga));
        if (ESTADOS_FINAIS_DA_SAGA.includes(saga.estado)) {
          avisar(saga.estado === "CONCLUIDA" ? "Oportunidade publicada." : `Publicação não concluída: ${saga.estado}.`, { erro: saga.estado !== "CONCLUIDA" });
          return;
        }
      } catch (erro) {
        avisar(erro.message, { erro: true });
        return;
      }
      await new Promise((resolver) => setTimeout(resolver, 700));
    }
  }

  async function desenharOportunidades(status) {
    limpar(area).append(esqueletos(2));
    let lista;
    try {
      lista = await ctx.api.admin.oportunidades({ status });
    } catch (erro) {
      limpar(area).append(blocoErro(erro, () => desenharOportunidades(status)));
      return;
    }
    if (!ativo) return;
    limpar(area).append(h("div", { classe: "linha linha--entre" }, h("h2", {}, ABAS.find((a) => a.id === status)?.rotulo ?? STATUS[status]), h("span", { classe: "chip chip--musgo numero" }, `${lista.total} no total`)));
    if (lista.itens.length === 0) {
      area.append(blocoVazio("inbox", "Nada aqui."));
      return;
    }

    for (const o of lista.itens) {
      const detalhe = h("div", {});
      const links = o._links ?? {};
      const botoes = [
        h(
          "button",
          {
            type: "button",
            classe: "botao botao--suave botao--p",
            aoClick: async (evento) => {
              if (detalhe.childElementCount > 0) return limpar(detalhe);
              await comEspera(evento.currentTarget, async () => {
                try {
                  limpar(detalhe).append(registroCompleto(await ctx.api.admin.oportunidade(o.id)));
                } catch (erro) {
                  avisar(erro.message, { erro: true });
                }
              });
            }
          },
          icone("eye"),
          "Ver registro completo"
        )
      ];
      if (links.editar) {
        botoes.push(
          h(
            "button",
            {
              type: "button",
              classe: "botao botao--contorno botao--p",
              aoClick: () => {
                if (detalhe.childElementCount > 0) return limpar(detalhe);
                limpar(detalhe).append(formularioOportunidade({ oportunidadeId: o.id, valores: o, aoConcluir: recarregar }));
              }
            },
            icone("pencil"),
            "Editar"
          )
        );
      }
      if (links.publicar) {
        botoes.push(
          h(
            "button",
            {
              type: "button",
              classe: "botao botao--p",
              aoClick: (evento) =>
                comEspera(evento.currentTarget, async () => {
                  try {
                    const { sagaId } = await ctx.api.admin.publicar(o.id);
                    avisar("Publicação aceita. Acompanhando a SAGA.");
                    await acompanharSaga(sagaId, detalhe);
                    if (ativo) setTimeout(() => ativo && recarregar(), 1500);
                  } catch (erro) {
                    avisar(erro.message, { erro: true });
                  }
                })
            },
            icone("play"),
            "Publicar"
          )
        );
      }
      if (links.encerrar) {
        botoes.push(
          h(
            "button",
            {
              type: "button",
              classe: "botao botao--perigo botao--p",
              aoClick: async () => {
                if (!(await confirmar({ titulo: "Encerrar oportunidade?", mensagem: `“${o.titulo}” sai da busca pública, os lembretes agendados são cancelados e quem salvou recebe um aviso.`, confirmar: "Encerrar", perigo: true }))) return;
                try {
                  await ctx.api.admin.encerrar(o.id);
                  avisar("Oportunidade encerrada.");
                  await recarregar();
                } catch (erro) {
                  avisar(erro.message, { erro: true });
                }
              }
            },
            icone("archive"),
            "Encerrar"
          )
        );
      }
      if (links.excluir) {
        botoes.push(
          h(
            "button",
            {
              type: "button",
              classe: "botao botao--perigo botao--p",
              aoClick: async () => {
                if (!(await confirmar({ titulo: "Excluir rascunho?", mensagem: `“${o.titulo}” será apagado e não pode ser recuperado.`, confirmar: "Excluir", perigo: true }))) return;
                try {
                  await ctx.api.admin.excluirOportunidade(o.id);
                  avisar("Rascunho excluído.");
                  await recarregar();
                } catch (erro) {
                  avisar(erro.message, { erro: true });
                }
              }
            },
            icone("trash-2"),
            "Excluir"
          )
        );
      }

      area.append(
        h(
          "article",
          { classe: "cartao pilha" },
          h(
            "div",
            { classe: "lista-chips" },
            h("span", { classe: "chip", dataset: { categoria: o.categoria } }, CATEGORIAS[o.categoria] ?? o.categoria),
            h("span", { classe: "chip", dataset: { estado: o.status } }, STATUS[o.status] ?? o.status),
            h("span", { classe: "chip chip--vazado" }, icone("map-pin"), CAMPI[o.campus] ?? o.campus),
            h("span", { classe: "chip chip--vazado" }, icone("calendar"), `Prazo: ${dataHora(o.prazoInscricao)}`)
          ),
          h("h3", {}, o.status === "PUBLICADA" ? h("a", { href: `#/oportunidades/${o.id}` }, o.titulo) : o.titulo),
          h("div", { classe: "linha" }, botoes),
          detalhe
        )
      );
    }
  }

  // ---------- Fontes de coleta ----------

  async function desenharFontes() {
    limpar(area).append(esqueletos(2));
    let fontes;
    let execucoes;
    try {
      [fontes, execucoes] = await Promise.all([ctx.api.admin.fontes(), ctx.api.admin.execucoes({ limite: 10 })]);
    } catch (erro) {
      limpar(area).append(blocoErro(erro, desenharFontes));
      return;
    }
    if (!ativo) return;
    const nomeDaFonte = new Map(fontes.itens.map((f) => [f.id, f.nome]));

    const nome = h("input", { name: "nome", required: true, maxlength: 120 });
    const url = h("input", { name: "url", type: "url", required: true });
    const tipo = h("select", { name: "tipo", valor: "JSON" }, h("option", { value: "JSON" }, "JSON (lista de itens)"), h("option", { value: "EXEMPLO" }, "Exemplo (dados de demonstração)"));
    const cron = h("input", { name: "periodicidadeCron", required: true, maxlength: 60, valor: "0 */6 * * *" });
    const salvar = h("button", { type: "submit", classe: "botao" }, icone("plus"), "Cadastrar fonte");

    const formulario = h(
      "form",
      {
        classe: "formulario painel",
        "aria-labelledby": "titulo-nova-fonte",
        aoSubmit: async (evento) => {
          evento.preventDefault();
          await comEspera(salvar, async () => {
            try {
              await ctx.api.admin.criarFonte({ nome: nome.value.trim(), url: url.value.trim(), tipo: tipo.value, periodicidadeCron: cron.value.trim() });
              avisar("Fonte cadastrada.");
              await desenharFontes();
            } catch (erro) {
              avisar(erro.message, { erro: true });
            }
          });
        }
      },
      h("h2", { id: "titulo-nova-fonte" }, "Nova fonte"),
      h(
        "div",
        { classe: "grade-campos" },
        campo("Nome", nome),
        campo("Tipo", tipo),
        campo("URL", url, { largo: true }),
        campo("Periodicidade (cron)", cron, { largo: true, ajuda: "Expressão cron de 5 campos. Exemplo: 0 */6 * * * (a cada 6 horas)." })
      ),
      h("div", { classe: "formulario__acoes" }, salvar)
    );

    limpar(area).append(
      h("h2", {}, "Fontes de coleta"),
      fontes.itens.length === 0
        ? blocoVazio("rss", "Nenhuma fonte cadastrada.")
        : h(
            "ul",
            { classe: "pilha" },
            fontes.itens.map((f) =>
              h(
                "li",
                { classe: "cartao pilha" },
                h(
                  "div",
                  { classe: "lista-chips" },
                  h("span", { classe: "chip" }, f.tipo),
                  h("span", { classe: "chip", dataset: { estado: f.ativa ? "PUBLICADA" : "CANCELADO" } }, f.ativa ? "Ativa" : "Inativa"),
                  h("span", { classe: "chip chip--vazado" }, h("span", { classe: "codigo" }, f.periodicidadeCron))
                ),
                h("h3", {}, f.nome),
                h("p", { classe: "pequeno suave" }, h("span", { classe: "codigo" }, f.url), f.ultimaExecucaoEm ? ` · última coleta em ${dataHora(f.ultimaExecucaoEm)}` : " · ainda não coletada"),
                h(
                  "div",
                  { classe: "linha" },
                  h(
                    "button",
                    {
                      type: "button",
                      classe: "botao botao--suave botao--p",
                      aoClick: (evento) =>
                        comEspera(evento.currentTarget, async () => {
                          try {
                            const execucao = await ctx.api.admin.executarColeta(f.id);
                            avisar(`Coleta ${execucao.estado}: ${execucao.itensNovos} novo(s), ${execucao.itensDuplicados} duplicado(s).`);
                            await desenharFontes();
                          } catch (erro) {
                            avisar(erro.message, { erro: true });
                          }
                        })
                    },
                    icone("play"),
                    "Executar coleta"
                  )
                )
              )
            )
          ),
      formulario,
      h("h2", {}, "Coletas recentes"),
      execucoes.itens.length === 0
        ? blocoVazio("rss", "Nenhuma coleta executada ainda.")
        : h(
            "ul",
            { classe: "pilha" },
            execucoes.itens.map((e) =>
              h(
                "li",
                { classe: "cartao item" },
                h(
                  "div",
                  { classe: "item__texto" },
                  h("h3", {}, nomeDaFonte.get(e.fonteId) ?? "Fonte removida"),
                  h(
                    "div",
                    { classe: "lista-chips" },
                    h("span", { classe: "chip", dataset: { estado: e.estado } }, rotuloDoEstado(e.estado)),
                    h("span", { classe: "chip chip--vazado numero" }, dataHora(e.iniciadaEm)),
                    h("span", { classe: "chip chip--vazado numero" }, `${e.itensEncontrados} encontrados · ${e.itensNovos} novos · ${e.itensDuplicados} duplicados`)
                  ),
                  e.erro && h("p", { classe: "pequeno suave" }, e.erro)
                )
              )
            )
          )
    );
  }

  await recarregar();
  return () => {
    ativo = false;
  };
}
