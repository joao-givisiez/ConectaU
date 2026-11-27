#!/usr/bin/env node
/**
 * Teste de integração das rotas que a interface chama, contra o sistema rodando (gateway → BFF → serviços).
 *
 * Usa public/js/api.js, o MESMO módulo da interface: se a tela chama uma rota, é esta rota que está sendo testada.
 *
 *   node tests/rotas.mjs                 rotas de leitura, escrita reversível e regras de acesso
 *   node tests/rotas.mjs --llm           inclui UMA pergunta real ao agente (consome o modelo da Groq)
 *   node tests/rotas.mjs --saga          inclui a publicação de uma oportunidade de teste (SAGA) e o encerramento dela
 *
 * Variáveis: BASE_URL (padrão http://localhost:8080), ADMIN_EMAIL e ADMIN_SENHA (ou o .env da raiz do repositório).
 * A conta de estudante criada tem e-mail único, e os registros de teste são removidos ou encerrados ao final.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErroApi, criarApi, criarCliente } from "../public/js/api.js";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const COM_LLM = process.argv.includes("--llm");
const COM_SAGA = process.argv.includes("--saga");
const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------- credenciais do administrador (nunca impressas) ----------

function lerEnvDaRaiz() {
  try {
    const texto = readFileSync(resolve(AQUI, "../../.env"), "utf8");
    return Object.fromEntries(
      texto
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    return {};
  }
}
const env = lerEnvDaRaiz();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? env.ADMIN_EMAIL;
const ADMIN_SENHA = process.env.ADMIN_SENHA ?? env.ADMIN_SENHA;

// ---------- clientes: anônimo, estudante e administrador ----------

function novoCliente() {
  const sessao = { token: null };
  const cliente = criarCliente({ base: BASE, obterToken: () => sessao.token });
  return { sessao, api: criarApi(cliente), requisitar: cliente.requisitar };
}
const anonimo = novoCliente();
const estudante = novoCliente();
const admin = novoCliente();

// ---------- mini executor de testes ----------

const resultados = [];
const rotasCobertas = new Set();
let secaoAtual = "";

function secao(titulo) {
  secaoAtual = titulo;
  console.log(`\n${titulo}`);
}

async function teste(rota, descricao, corpo) {
  rotasCobertas.add(rota);
  const inicio = performance.now();
  try {
    await corpo();
    const ms = Math.round(performance.now() - inicio);
    resultados.push({ secao: secaoAtual, rota, descricao, ok: true });
    console.log(`  OK      ${rota.padEnd(44)} ${descricao} (${ms} ms)`);
  } catch (erro) {
    resultados.push({ secao: secaoAtual, rota, descricao, ok: false, erro: erro.message });
    console.log(`  FALHOU  ${rota.padEnd(44)} ${descricao}\n          ${erro.message}`);
  }
}

function afirmar(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * O gateway limita /web/conversas/** a 10 por minuto com rajada de 5 (por IP). Em vez de burlar o limite,
 * o teste espera a fila andar: ao receber 429, aguarda e repete.
 */
async function respeitandoLimite(chamada) {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await chamada();
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 429 && tentativa < 6) {
        await dormir(7000);
        continue;
      }
      throw erro;
    }
  }
}

/** Aceita uma promessa pronta ou uma função (esta última é repetida se o gateway responder 429). */
async function esperaErro(promessaOuFuncao, status, codigo) {
  try {
    await (typeof promessaOuFuncao === "function" ? respeitandoLimite(promessaOuFuncao) : promessaOuFuncao);
  } catch (erro) {
    afirmar(erro instanceof ErroApi, `esperava ErroApi, veio ${erro?.name}: ${erro?.message}`);
    afirmar(erro.status === status, `esperava HTTP ${status}, veio ${erro.status} (${erro.message})`);
    if (codigo) afirmar(erro.codigo === codigo, `esperava código ${codigo}, veio ${erro.codigo}`);
    return erro;
  }
  throw new Error(`esperava erro HTTP ${status}, mas a chamada deu certo`);
}

const sufixo = `${Date.now().toString(36)}`;
const dias = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

// ---------- 0. o gateway está de pé ----------

console.log(`Gateway: ${BASE}`);
try {
  const resposta = await fetch(`${BASE}/web/oportunidades?limite=1`, { signal: AbortSignal.timeout(8000) });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
} catch (erro) {
  console.error(`\nNão consegui falar com o gateway em ${BASE}: ${erro.message}\nSuba o sistema com "docker compose up -d" e tente de novo.`);
  process.exit(2);
}

// ---------- 1. público (sem login) ----------

secao("1. Público, sem login");
let primeira;

await teste("GET /web/oportunidades", "lista pública com a forma de card", async () => {
  const lista = await anonimo.api.web.oportunidades();
  afirmar(Array.isArray(lista.itens) && typeof lista.total === "number", "resposta sem itens/total");
  afirmar(lista.itens.length > 0, "nenhuma oportunidade publicada: publique uma para testar o resto");
  primeira = lista.itens[0];
  for (const campo of ["id", "titulo", "campus", "categoria", "prazoEmDias"]) {
    afirmar(primeira[campo] !== undefined, `card sem o campo ${campo}`);
  }
});

await teste("GET /web/oportunidades?campus&categoria", "filtros combinados", async () => {
  const lista = await anonimo.api.web.oportunidades({ campus: primeira.campus, categoria: primeira.categoria });
  afirmar(lista.itens.length > 0, "o filtro da própria primeira oportunidade devolveu vazio");
  afirmar(lista.itens.every((o) => o.campus === primeira.campus && o.categoria === primeira.categoria), "item fora do filtro");
});

await teste("GET /web/oportunidades?busca", "busca textual em português", async () => {
  const palavra = primeira.titulo.split(/\s+/).find((p) => p.length > 4) ?? primeira.titulo;
  const lista = await anonimo.api.web.oportunidades({ busca: palavra });
  afirmar(lista.itens.some((o) => o.id === primeira.id), `a busca por "${palavra}" não achou a oportunidade`);
});

await teste("GET /web/oportunidades?pagina", "paginação", async () => {
  const lista = await anonimo.api.web.oportunidades({ pagina: 1 });
  afirmar(lista.pagina === 1 && lista.limite >= 1, "paginação ausente");
});

await teste("GET /web/oportunidades?campus=INVALIDO", "campo inválido vira 400", async () => {
  await esperaErro(anonimo.api.web.oportunidades({ campus: "INVALIDO" }), 400, "REQUISICAO_INVALIDA");
});

await teste("GET /web/feed (anônimo)", "feed sem perfil", async () => {
  const feed = await anonimo.api.web.feed();
  afirmar(feed.itens.length > 0 && feed.filtro, "feed vazio ou sem o bloco filtro");
});

await teste("GET /web/oportunidades/:id", "detalhe público com links HATEOAS", async () => {
  const o = await anonimo.api.web.oportunidade(primeira.id);
  afirmar(o.titulo === primeira.titulo && o.prazoInscricao, "detalhe diferente do card");
  afirmar(o._links?.fonteOficial?.href, "sem link fonteOficial");
  afirmar(!o._links.salvar && !o._links.perguntar, "anônimo não deveria receber links de ação");
});

await teste("GET /web/oportunidades/:id (inexistente)", "id desconhecido vira 404", async () => {
  await esperaErro(anonimo.api.web.oportunidade("00000000-0000-4000-8000-000000000000"), 404);
});

await teste("GET /web/oportunidades/:id (formato)", "id que não é UUID vira 404 (id inválido nunca existe)", async () => {
  await esperaErro(anonimo.api.web.oportunidade("nao-e-uuid"), 404);
});

// ---------- 2. contas e sessão ----------

secao("2. Cadastro e login");
const credenciais = { email: `teste.frontend.${sufixo}@exemplo.com`, senha: "senha-de-teste-123" };

await teste("POST /auth/usuarios", "cadastro de estudante", async () => {
  const usuario = await anonimo.api.auth.cadastrar({
    nome: "Estudante de Teste",
    ...credenciais,
    curso: "Ciência da Computação",
    campus: primeira.campus,
    interesses: ["tecnologia"]
  });
  afirmar(usuario.id && usuario.papel === "ESTUDANTE", "cadastro sem id ou papel diferente de ESTUDANTE");
});

await teste("POST /auth/usuarios (e-mail repetido)", "duplicado vira 409", async () => {
  await esperaErro(
    anonimo.api.auth.cadastrar({ nome: "Outra", ...credenciais, curso: "X", campus: primeira.campus, interesses: [] }),
    409,
    "CONFLITO"
  );
});

await teste("POST /auth/usuarios (senha curta)", "senha de 3 caracteres vira 400", async () => {
  await esperaErro(
    anonimo.api.auth.cadastrar({ nome: "Curta", email: `curta.${sufixo}@exemplo.com`, senha: "123", curso: "X", campus: primeira.campus }),
    400
  );
});

await teste("POST /auth/sessoes (senha errada)", "credencial errada vira 401", async () => {
  await esperaErro(anonimo.api.auth.entrar({ email: credenciais.email, senha: "errada-errada" }), 401, "NAO_AUTENTICADO");
});

await teste("POST /auth/sessoes", "login devolve token e papel", async () => {
  const sessao = await anonimo.api.auth.entrar(credenciais);
  afirmar(sessao.token && sessao.papel === "ESTUDANTE" && sessao.usuarioId, "sessão incompleta");
  estudante.sessao.token = sessao.token;
});

// ---------- 3. regras de acesso ----------

secao("3. Quem pode o quê");

await teste("GET /web/perfil (sem token)", "rota pessoal sem login vira 401", async () => {
  await esperaErro(anonimo.api.web.perfil(), 401);
});

await teste("GET /web/favoritos (sem token)", "favoritos sem login vira 401", async () => {
  await esperaErro(anonimo.api.web.favoritos(), 401);
});

await teste("POST /web/conversas (sem token)", "assistente sem login vira 401", async () => {
  await esperaErro(anonimo.api.web.criarConversa(), 401);
});

await teste("GET /admin/fontes (sem token)", "admin sem login vira 401", async () => {
  await esperaErro(anonimo.api.admin.fontes(), 401);
});

await teste("GET /admin/fontes (estudante)", "admin com papel ESTUDANTE vira 403", async () => {
  await esperaErro(estudante.api.admin.fontes(), 403);
});

await teste("GET /web/perfil (token adulterado)", "token inválido vira 401", async () => {
  const falso = novoCliente();
  falso.sessao.token = `${estudante.sessao.token.slice(0, -4)}AAAA`;
  await esperaErro(falso.api.web.perfil(), 401);
});

// ---------- 4. estudante ----------

secao("4. Estudante: perfil, feed, favoritos, lembretes e avisos");

await teste("GET /web/perfil", "perfil do dono", async () => {
  const perfil = await estudante.api.web.perfil();
  afirmar(perfil.email === credenciais.email && perfil.interesses.includes("tecnologia"), "perfil não confere com o cadastro");
});

await teste("PATCH /web/perfil", "atualiza curso e interesses", async () => {
  const perfil = await estudante.api.web.atualizarPerfil({ curso: "Sistemas de Informação", interesses: ["pesquisa", "tecnologia"] });
  afirmar(perfil.curso === "Sistemas de Informação" && perfil.interesses.length === 2, "alteração não aplicada");
});

await teste("GET /web/feed (logado)", "feed personalizado devolve o filtro do perfil", async () => {
  const feed = await estudante.api.web.feed();
  afirmar(feed.filtro.campus === primeira.campus, "o feed não usou o campus do perfil");
});

await teste("GET /web/oportunidades/:id (logado)", "links de ação aparecem para quem tem sessão", async () => {
  const o = await estudante.api.web.oportunidade(primeira.id);
  afirmar(o._links.perguntar && o._links.salvar && o.salvo === false, "faltam links salvar/perguntar ou salvo != false");
});

let favoritoId;
await teste("POST /web/favoritos", "salvar oportunidade", async () => {
  const favorito = await estudante.api.web.salvar(primeira.id);
  afirmar(favorito.id && favorito.oportunidadeId === primeira.id, "favorito mal formado");
  favoritoId = favorito.id;
});

await teste("POST /web/favoritos (repetido)", "salvar de novo vira 409", async () => {
  await esperaErro(estudante.api.web.salvar(primeira.id), 409, "CONFLITO");
});

await teste("GET /web/favoritos", "lista inclui o salvo, com título", async () => {
  const lista = await estudante.api.web.favoritos();
  const achado = lista.itens.find((f) => f.id === favoritoId);
  afirmar(achado?.oportunidade?.titulo === primeira.titulo, "favorito sem o resumo da oportunidade");
});

await teste("GET /web/oportunidades/:id (salva)", "detalhe traz salvo=true e favoritoId", async () => {
  const o = await estudante.api.web.oportunidade(primeira.id);
  afirmar(o.salvo === true && o.favoritoId === favoritoId, "estado de salvo não refletido");
});

let lembreteId;
await teste("POST /web/lembretes", "criar lembrete com antecedência", async () => {
  const lembrete = await estudante.api.web.criarLembrete(primeira.id, 24);
  afirmar(lembrete.antecedenciaHoras === 24 && lembrete.estado === "AGENDADO", "lembrete mal formado");
  lembreteId = lembrete.id;
});

await teste("POST /web/lembretes (repetido)", "segundo lembrete vira 409", async () => {
  await esperaErro(estudante.api.web.criarLembrete(primeira.id, 24), 409, "CONFLITO");
});

await teste("POST /web/lembretes (720 h)", "antecedência fora do limite vira 400", async () => {
  await esperaErro(estudante.api.web.criarLembrete(primeira.id, 721), 400);
});

await teste("GET /web/lembretes", "lista inclui o lembrete", async () => {
  const lista = await estudante.api.web.lembretes();
  afirmar(lista.itens.some((l) => l.id === lembreteId), "lembrete criado não apareceu");
});

await teste("DELETE /web/lembretes/:id", "excluir lembrete (204)", async () => {
  await estudante.api.web.removerLembrete(lembreteId);
  const lista = await estudante.api.web.lembretes();
  afirmar(!lista.itens.some((l) => l.id === lembreteId), "lembrete continua na lista");
});

await teste("GET /web/notificacoes", "lista de avisos e filtro por não lidos", async () => {
  const todas = await estudante.api.web.notificacoes();
  const naoLidas = await estudante.api.web.notificacoes({ lida: false, limite: 1 });
  afirmar(Array.isArray(todas.itens) && typeof naoLidas.total === "number", "formato inesperado");
});

await teste("PATCH /web/notificacoes/:id (inexistente)", "marcar aviso que não existe vira 404", async () => {
  await esperaErro(estudante.api.web.marcarComoLida("00000000-0000-4000-8000-000000000000"), 404);
});

await teste("DELETE /web/favoritos/:id", "remover dos salvos (204)", async () => {
  await estudante.api.web.removerFavorito(favoritoId);
  const o = await estudante.api.web.oportunidade(primeira.id);
  afirmar(o.salvo === false, "ainda consta como salvo");
});

// ---------- 5. assistente ----------

secao("5. Assistente (agente)");
let conversaId;

await teste("POST /web/conversas", "abre conversa geral", async () => {
  const conversa = await respeitandoLimite(() => estudante.api.web.criarConversa());
  afirmar(conversa.id, "conversa sem id");
  conversaId = conversa.id;
});

await teste("POST /web/conversas (com oportunidadeId)", "abre conversa restrita a um edital", async () => {
  const conversa = await respeitandoLimite(() => estudante.api.web.criarConversa(primeira.id));
  afirmar(conversa.oportunidadeId === primeira.id, "conversa sem o oportunidadeId");
});

await teste("POST /web/conversas (id inválido)", "oportunidadeId que não é UUID vira 400", async () => {
  await esperaErro(() => estudante.api.web.criarConversa("nao-e-uuid"), 400);
});

/** O Assistente só fica pronto depois de carregar o modelo de embeddings; espera até 90 s (e respeita o limite de 429). */
async function perguntarComEspera(id, pergunta, extras) {
  const limite = Date.now() + 90000;
  for (;;) {
    try {
      return await respeitandoLimite(() => estudante.api.web.perguntar(id, pergunta, extras));
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 503 && Date.now() < limite) {
        await dormir(3000);
        continue;
      }
      throw erro;
    }
  }
}

await teste("POST /web/conversas/:id/mensagens (modo recuperacao)", "só busca vetorial, sem chamar o modelo", async () => {
  const m = await perguntarComEspera(conversaId, "Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada?", { modo: "recuperacao" });
  afirmar(m.origem === "FALLBACK" && m.modo === "recuperacao", `origem/modo inesperados: ${m.origem}/${m.modo}`);
  afirmar(m.fontes.length > 0 && /48/.test(m.resposta), "a base de conhecimento não trouxe a regra das 48 horas");
  for (const campo of ["id", "resposta", "fontes", "latenciaMs", "tokens", "criadaEm"]) afirmar(m[campo] !== undefined, `resposta sem ${campo}`);
  afirmar(m.fontes.every((f) => f.id && f.tipo && f.titulo && f.trecho), "fonte sem id/tipo/titulo/trecho");
});

await teste("POST /web/conversas/:id/mensagens (fora do escopo)", "guarda de escopo recusa antes do modelo", async () => {
  const m = await perguntarComEspera(conversaId, "Qual a melhor receita de bolo de chocolate?");
  afirmar(m.origem === "RECUSA", `esperava RECUSA, veio ${m.origem}`);
  afirmar(m.tokens.entrada === 0 && m.tokens.saida === 0, "recusa não deveria gastar tokens");
});

await teste("POST /web/conversas/:id/mensagens (vazia)", "pergunta vazia vira 400", async () => {
  await esperaErro(() => estudante.api.web.perguntar(conversaId, ""), 400);
});

await teste("POST /web/conversas/:id/mensagens (outra conta)", "conversa de outro usuário vira 403", async () => {
  const intruso = novoCliente();
  const outro = `intruso.${sufixo}@exemplo.com`;
  await anonimo.api.auth.cadastrar({ nome: "Intruso", email: outro, senha: "senha-de-teste-123", curso: "X", campus: primeira.campus });
  intruso.sessao.token = (await anonimo.api.auth.entrar({ email: outro, senha: "senha-de-teste-123" })).token;
  await esperaErro(() => intruso.api.web.perguntar(conversaId, "oi", { modo: "recuperacao" }), 403);
});

await teste("POST /web/conversas/:id/mensagens (conversa inexistente)", "conversa desconhecida vira 404", async () => {
  await esperaErro(() => estudante.api.web.perguntar("00000000-0000-4000-8000-000000000000", "oi"), 404);
});

if (COM_LLM) {
  await teste("POST /web/conversas/:id/mensagens (agente real)", "uma pergunta ao agente com o modelo da Groq", async () => {
    const m = await perguntarComEspera(conversaId, "Quais oportunidades estão abertas no campus de Lavras e quando fecham?", {});
    console.log(`          origem=${m.origem} modelo=${m.modelo ?? "-"} latência=${m.latenciaMs} ms tokens=${m.tokens.entrada + m.tokens.saida} ferramentas=[${m.ferramentas.map((f) => f.nome).join(", ")}] fontes=${m.fontes.length}`);
    afirmar(["LLM", "CACHE", "FALLBACK"].includes(m.origem), `origem inesperada: ${m.origem}`);
    afirmar(m.resposta.trim().length > 0, "resposta vazia");
  });
} else {
  console.log("  (pulado)  agente real com o modelo: rode com --llm para gastar UMA pergunta da Groq");
}

// ---------- 6. administrador ----------

secao("6. Administrador: curadoria");

if (!ADMIN_EMAIL || !ADMIN_SENHA) {
  console.log("  (pulado)  sem ADMIN_EMAIL/ADMIN_SENHA no ambiente nem no .env da raiz");
} else {
  await teste("POST /auth/sessoes (admin)", "login do administrador", async () => {
    const sessao = await anonimo.api.auth.entrar({ email: ADMIN_EMAIL, senha: ADMIN_SENHA });
    afirmar(sessao.papel === "ADMIN", `papel ${sessao.papel}`);
    admin.sessao.token = sessao.token;
  });

  await teste("GET /admin/fontes", "lista de fontes", async () => {
    const lista = await admin.api.admin.fontes();
    afirmar(Array.isArray(lista.itens), "sem itens");
  });

  await teste("GET /admin/execucoes", "coletas recentes", async () => {
    afirmar(Array.isArray((await admin.api.admin.execucoes({ limite: 5 })).itens), "sem itens");
  });

  await teste("GET /admin/candidatos?status=PENDENTE", "fila de curadoria", async () => {
    const lista = await admin.api.admin.candidatos({ status: "PENDENTE" });
    afirmar(typeof lista.total === "number", "sem total");
  });

  for (const status of ["RASCUNHO", "PUBLICANDO", "PUBLICADA", "ENCERRADA"]) {
    await teste(`GET /admin/oportunidades?status=${status}`, `lista por status`, async () => {
      const lista = await admin.api.admin.oportunidades({ status });
      afirmar(lista.itens.every((o) => o.status === status), "item com status diferente do filtro");
    });
  }

  await teste("GET /admin/oportunidades/:id", "registro completo (dados + origem + SAGA)", async () => {
    const lista = await admin.api.admin.oportunidades({ status: "PUBLICADA", limite: 1 });
    afirmar(lista.itens.length > 0, "sem oportunidade publicada para detalhar");
    const registro = await admin.api.admin.oportunidade(lista.itens[0].id);
    afirmar(registro.origem && registro.versao >= 1, "registro sem origem/versão");
  });

  await teste("GET /admin/candidatos/:id (inexistente)", "candidato desconhecido vira 404", async () => {
    await esperaErro(admin.api.admin.candidato("00000000-0000-4000-8000-000000000000"), 404);
  });

  // Ciclo reversível: candidato manual → rascunho → edição → exclusão → candidato descartado.
  let candidato;
  let rascunho;
  await teste("POST /admin/candidatos", "cadastro manual de candidato", async () => {
    candidato = await admin.api.admin.registrarCandidato({
      titulo: `[teste-frontend] Oficina ${sufixo}`,
      descricao: "Registro criado pelo teste de rotas do front-end. Pode ser descartado.",
      data: dias(20),
      solicitante: "teste automatizado",
      urlOrigem: "https://exemplo.com/oficina"
    });
    afirmar(candidato.status === "PENDENTE" && candidato.origem === "MANUAL", "candidato mal formado");
  });

  await teste("POST /admin/oportunidades", "criar rascunho a partir do candidato", async () => {
    rascunho = await admin.api.admin.criarOportunidade({
      candidatoId: candidato.id,
      titulo: candidato.tituloExtraido,
      descricao: "Descrição do rascunho de teste.",
      categoria: "EVENTO",
      campus: "LAVRAS",
      dataInicio: dias(20),
      prazoInscricao: dias(15),
      fonteUrl: "https://exemplo.com/oficina",
      tags: ["teste"]
    });
    afirmar(rascunho.status === "RASCUNHO" && rascunho._links.publicar, "rascunho sem status RASCUNHO ou sem link publicar");
  });

  await teste("PATCH /admin/oportunidades/:id", "editar rascunho (versão sobe)", async () => {
    const editado = await admin.api.admin.editarOportunidade(rascunho.id, { descricao: "Descrição editada.", tags: ["teste", "editado"] });
    afirmar(editado.versao === rascunho.versao + 1 && editado.tags.includes("editado"), "edição não aplicada");
  });

  await teste("POST /admin/oportunidades (prazo depois do início)", "datas incoerentes viram 4xx", async () => {
    try {
      await admin.api.admin.criarOportunidade({
        candidatoId: candidato.id,
        titulo: "x",
        categoria: "EVENTO",
        campus: "LAVRAS",
        dataInicio: dias(1),
        prazoInscricao: dias(5),
        fonteUrl: "https://exemplo.com"
      });
    } catch (erro) {
      afirmar(erro instanceof ErroApi && erro.status >= 400 && erro.status < 500, `esperava 4xx, veio ${erro.status}`);
      return;
    }
    throw new Error("aceitou prazo depois do início");
  });

  await teste("DELETE /admin/oportunidades/:id", "excluir rascunho (204)", async () => {
    await admin.api.admin.excluirOportunidade(rascunho.id);
    await esperaErro(admin.api.admin.oportunidade(rascunho.id), 404);
  });

  await teste("PATCH /admin/candidatos/:id", "descartar candidato de teste", async () => {
    const atualizado = await admin.api.admin.atualizarCandidato(candidato.id, "DESCARTADO");
    afirmar(atualizado.status === "DESCARTADO", "status não mudou");
  });

  await teste("PATCH /admin/candidatos/:id (já descartado)", "alterar de novo vira 409", async () => {
    await esperaErro(admin.api.admin.atualizarCandidato(candidato.id, "DUPLICADO"), 409, "CONFLITO");
  });

  if (COM_SAGA) {
    secao("6b. Publicação (SAGA) e encerramento");
    let cand2;
    let op;
    let sagaId;
    await teste("POST /admin/candidatos + /admin/oportunidades", "prepara um rascunho de teste para publicar", async () => {
      cand2 = await admin.api.admin.registrarCandidato({
        titulo: `[teste-frontend] Publicação ${sufixo}`,
        descricao: "Oportunidade criada pelo teste da SAGA do front-end. Será encerrada em seguida.",
        data: dias(30),
        solicitante: "teste automatizado",
        urlOrigem: "https://exemplo.com/saga"
      });
      op = await admin.api.admin.criarOportunidade({
        candidatoId: cand2.id,
        titulo: cand2.tituloExtraido,
        descricao: "Texto indexado pelo Assistente durante a SAGA de teste.",
        categoria: "ATIVIDADE",
        campus: "LAVRAS",
        dataInicio: dias(30),
        prazoInscricao: dias(25),
        fonteUrl: "https://exemplo.com/saga",
        tags: ["teste"]
      });
    });

    await teste("POST /admin/oportunidades/:id/publicacao", "dispara a SAGA (202)", async () => {
      const aceite = await admin.api.admin.publicar(op.id);
      afirmar(aceite.sagaId && aceite.estado === "INICIADA", "aceite sem sagaId");
      sagaId = aceite.sagaId;
    });

    await teste("GET /admin/publicacoes/:sagaId", "acompanha os passos até CONCLUIDA", async () => {
      let saga;
      const limite = Date.now() + 60000;
      do {
        saga = await admin.api.admin.publicacao(sagaId);
        if (["CONCLUIDA", "COMPENSADA", "FALHA_COMPENSACAO"].includes(saga.estado)) break;
        await new Promise((r) => setTimeout(r, 700));
      } while (Date.now() < limite);
      afirmar(saga.estado === "CONCLUIDA", `SAGA terminou em ${saga.estado}${saga.erro ? `: ${saga.erro}` : ""}`);
      afirmar(saga.passos.length === 3 && saga.passos.every((p) => p.estado === "OK"), "nem todos os passos estão OK");
    });

    await teste("GET /web/oportunidades?busca (após a SAGA)", "a publicada aparece na busca pública (CQRS, consistência eventual)", async () => {
      const limite = Date.now() + 20000;
      let achou = false;
      while (!achou && Date.now() < limite) {
        const lista = await anonimo.api.web.oportunidades({ busca: `Publicação ${sufixo}` });
        achou = lista.itens.some((o) => o.id === op.id);
        if (!achou) await new Promise((r) => setTimeout(r, 700));
      }
      afirmar(achou, "a oportunidade publicada não chegou ao modelo de leitura em 20 s");
    });

    await teste("POST /admin/oportunidades/:id/encerramento", "encerra a oportunidade de teste", async () => {
      const encerrada = await admin.api.admin.encerrar(op.id);
      afirmar(encerrada.status === "ENCERRADA", "status não mudou para ENCERRADA");
    });
  } else {
    console.log("  (pulado)  publicação pela SAGA: rode com --saga (cria e encerra uma oportunidade de teste)");
  }
}

// ---------- resumo ----------

const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações passaram · ${rotasCobertas.size} rotas/variações exercitadas`);
if (falhas.length > 0) {
  console.log("\nFalhas:");
  for (const f of falhas) console.log(`  - [${f.secao}] ${f.rota}: ${f.erro}`);
  process.exit(1);
}
