// Demonstração de ponta a ponta do ConectaU, sempre pelo API Gateway (como um cliente real).
//
//   node scripts/demonstracao.mjs [--url=http://localhost:8080] [--falha=compose|k8s|nenhuma]
//
// Lê ADMIN_EMAIL e ADMIN_SENHA do ambiente ou do arquivo .env.
// Com --falha=compose (padrão) ou --falha=k8s, o roteiro derruba o Assistente para provocar
// a compensação da SAGA e depois o religa.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"])
);
const BASE = argumentos.url ?? "http://localhost:8080";
const MODO_FALHA = argumentos.falha ?? "compose";

const ambiente = { ...lerEnv(".env"), ...process.env };
const ADMIN = { email: ambiente.ADMIN_EMAIL, senha: ambiente.ADMIN_SENHA };

let passo = 0;
let falhas = 0;
const titulo = (texto) => console.log(`\n=== ${++passo}. ${texto}`);
const ok = (texto) => console.log(`   ✔ ${texto}`);
const ruim = (texto) => {
  falhas++;
  console.log(`   ✘ ${texto}`);
};
const confere = (condicao, texto) => (condicao ? ok(texto) : ruim(texto));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  return Object.fromEntries(
    readFileSync(arquivo, "utf8")
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
}

async function api(metodo, caminho, { token, corpo, cabecalhos = {} } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      Accept: "application/json",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...cabecalhos
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await resposta.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : undefined;
  } catch {
    dados = texto;
  }
  return { status: resposta.status, dados };
}

async function acompanharSaga(token, sagaId) {
  for (let i = 0; i < 60; i++) {
    const { dados } = await api("GET", `/admin/publicacoes/${sagaId}`, { token });
    if (["CONCLUIDA", "COMPENSADA", "FALHA_COMPENSACAO"].includes(dados.estado)) return dados;
    await esperar(500);
  }
  throw new Error("A SAGA não terminou em 30 s");
}

function derrubarAssistente(ligar) {
  if (MODO_FALHA === "compose") execSync(`docker compose ${ligar ? "start" : "stop"} assistente`, { stdio: "ignore" });
  if (MODO_FALHA === "k8s")
    execSync(`kubectl scale deployment assistente -n conectau --replicas=${ligar ? 1 : 0}`, { stdio: "ignore" });
}

async function principal() {
  console.log(`ConectaU — demonstração de ponta a ponta via gateway em ${BASE}`);

  titulo("Clientes servidos pelo gateway");
  confere((await fetch(`${BASE}/`)).ok, "Portal Web em /");
  confere((await fetch(`${BASE}/painel/`)).ok, "Painel Admin em /painel/");

  titulo("Login do administrador (gateway → Identidade, JWT)");
  const loginAdmin = await api("POST", "/auth/sessoes", { corpo: ADMIN });
  confere(loginAdmin.status === 201 && loginAdmin.dados.papel === "ADMIN", `POST /auth/sessoes → ${loginAdmin.status}, papel ${loginAdmin.dados?.papel}`);
  const admin = loginAdmin.dados.token;

  titulo("Curadoria: candidatos PENDENTES vindos da Coleta (MongoDB)");
  const fila = await api("GET", "/admin/candidatos?status=PENDENTE&limite=50", { token: admin });
  confere(fila.status === 200 && fila.dados.itens.length >= 2, `${fila.dados.total} candidato(s) pendente(s)`);
  const [candidatoA, candidatoB] = fila.dados.itens;

  const prazo = new Date(Date.now() + 7 * 864e5).toISOString();
  const inicio = new Date(Date.now() + 10 * 864e5).toISOString();
  const criar = (c, tags) =>
    api("POST", "/admin/oportunidades", {
      token: admin,
      corpo: {
        candidatoId: c.id,
        titulo: c.tituloExtraido,
        descricao: c.descricaoExtraida,
        categoria: "EVENTO",
        campus: "LAVRAS",
        dataInicio: inicio,
        prazoInscricao: prazo,
        fonteUrl: c.urlOrigem,
        tags
      }
    });

  titulo("Cadastro de oportunidade (RASCUNHO) com HATEOAS");
  const criada = await criar(candidatoA, ["tecnologia", "containers"]);
  confere(criada.status === 201 && criada.dados.status === "RASCUNHO", `POST /admin/oportunidades → ${criada.status}, ${criada.dados.status}`);
  confere(Boolean(criada.dados._links?.publicar), `link "publicar" presente: ${criada.dados._links?.publicar?.href}`);
  const oportunidadeA = criada.dados.id;

  titulo("SAGA de publicação — caminho feliz (Oportunidades → Coleta → Assistente)");
  const publicacao = await api("POST", `/admin/oportunidades/${oportunidadeA}/publicacao`, { token: admin });
  confere(publicacao.status === 202, `POST .../publicacao → ${publicacao.status} (assíncrono), sagaId ${publicacao.dados.sagaId}`);
  const sagaA = await acompanharSaga(admin, publicacao.dados.sagaId);
  confere(sagaA.estado === "CONCLUIDA", `SAGA ${sagaA.estado}`);
  for (const p of sagaA.passos) console.log(`     - ${p.passo}: ${p.estado} (${p.detalhe ?? ""})`);

  titulo("CQRS: a busca pública (modelo de leitura) reflete a publicação");
  let busca;
  const inicioBusca = Date.now();
  for (let i = 0; i < 20; i++) {
    busca = await api("GET", `/web/oportunidades?busca=${encodeURIComponent(candidatoA.tituloExtraido.split(" ")[0])}`);
    if (busca.dados.itens.some((o) => o.id === oportunidadeA)) break;
    await esperar(250);
  }
  confere(busca.dados.itens.some((o) => o.id === oportunidadeA), `encontrada na busca após ~${Date.now() - inicioBusca} ms (consistência eventual)`);

  titulo("Estudante: cadastro, login e feed personalizado (BFF Web)");
  const email = `estudante.${Date.now()}@ufla.example`;
  const cadastro = await api("POST", "/auth/usuarios", {
    corpo: { nome: "Estudante Demo", email, senha: "senha-segura-123", curso: "Ciência da Computação", campus: "LAVRAS", interesses: ["tecnologia"] }
  });
  confere(cadastro.status === 201 && cadastro.dados.papel === "ESTUDANTE", `POST /auth/usuarios → ${cadastro.status}, papel ${cadastro.dados?.papel}`);
  const estudante = (await api("POST", "/auth/sessoes", { corpo: { email, senha: "senha-segura-123" } })).dados.token;
  const feed = await api("GET", "/web/feed", { token: estudante });
  confere(feed.status === 200 && feed.dados.itens.some((o) => o.id === oportunidadeA), `feed filtrado por ${JSON.stringify(feed.dados.filtro)}`);
  console.log(`     card do BFF Web: ${JSON.stringify(feed.dados.itens[0])}`);

  titulo("BFF: a mesma oportunidade vista por cada cliente");
  const visaoWeb = await api("GET", `/web/oportunidades/${oportunidadeA}`, { token: estudante });
  const visaoAdmin = await api("GET", `/admin/oportunidades/${oportunidadeA}`, { token: admin });
  console.log(`     Web   → campos: ${Object.keys(visaoWeb.dados).join(", ")}`);
  console.log(`     Admin → campos: ${Object.keys(visaoAdmin.dados).join(", ")}`);
  confere(Boolean(visaoWeb.dados._links?.salvar) && !visaoWeb.dados._links?.publicar, `links do estudante: ${Object.keys(visaoWeb.dados._links).join(", ")}`);
  confere(Boolean(visaoAdmin.dados.origem?.tipo) && Boolean(visaoAdmin.dados.saga), "admin recebe procedência e passos da SAGA");

  titulo("Engajamento: favorito e lembrete (cópia local via evento)");
  const favorito = await api("POST", "/web/favoritos", { token: estudante, corpo: { oportunidadeId: oportunidadeA } });
  confere(favorito.status === 201, `POST /web/favoritos → ${favorito.status}`);
  const repetido = await api("POST", "/web/favoritos", { token: estudante, corpo: { oportunidadeId: oportunidadeA } });
  confere(repetido.status === 409, `favorito duplicado → ${repetido.status}`);
  const lembrete = await api("POST", "/web/lembretes", { token: estudante, corpo: { oportunidadeId: oportunidadeA, antecedenciaHoras: 48 } });
  confere(lembrete.status === 201, `POST /web/lembretes → ${lembrete.status}, dispara em ${lembrete.dados?.dispararEm}`);

  titulo("Assistente: busca vetorial no pgvector sobre o texto indexado pela SAGA");
  const conversa = await api("POST", "/web/conversas", { token: estudante, corpo: { oportunidadeId: oportunidadeA } });
  const resposta = await api("POST", `/web/conversas/${conversa.dados.id}/mensagens`, {
    token: estudante,
    corpo: { pergunta: "Quantas vagas e o que preciso levar?" }
  });
  confere(resposta.status === 201 && resposta.dados.citacoes.length > 0, `${resposta.dados.citacoes?.length} trecho(s) citado(s), degradada=${resposta.dados.degradada}`);
  if (resposta.dados.citacoes?.[0]) console.log(`     trecho: "${resposta.dados.citacoes[0].trecho.slice(0, 110)}..."`);

  titulo("Segurança no gateway");
  confere((await api("GET", "/admin/candidatos")).status === 401, "/admin sem token → 401");
  confere((await api("GET", "/admin/candidatos", { token: estudante })).status === 403, "/admin com token de ESTUDANTE → 403");
  const forjado = await api("GET", "/web/favoritos", { cabecalhos: { "X-Usuario-Id": "00000000-0000-0000-0000-000000000000", "X-Usuario-Papel": "ADMIN" } });
  confere(forjado.status === 401, `cabeçalho X-Usuario-* forjado sem token → ${forjado.status} (o gateway descarta)`);
  confere((await api("GET", "/web/feed", { token: "token.invalido.qualquer" })).status === 401, "token inválido → 401");

  if (MODO_FALHA !== "nenhuma") {
    titulo(`SAGA com falha e compensação (Assistente fora do ar via ${MODO_FALHA})`);
    const criadaB = await criar(candidatoB, ["pesquisa"]);
    const oportunidadeB = criadaB.dados.id;
    derrubarAssistente(false);
    console.log("     Assistente parado; publicando...");
    const publicacaoB = await api("POST", `/admin/oportunidades/${oportunidadeB}/publicacao`, { token: admin });
    const sagaB = await acompanharSaga(admin, publicacaoB.dados.sagaId);
    derrubarAssistente(true);
    confere(sagaB.estado === "COMPENSADA", `SAGA ${sagaB.estado} — ${sagaB.erro ?? ""}`);
    for (const p of sagaB.passos) console.log(`     - ${p.passo}: ${p.estado}`);
    const candidatoDepois = await api("GET", `/admin/candidatos/${candidatoB.id}`, { token: admin });
    confere(candidatoDepois.dados.status === "PENDENTE", `candidato liberado de volta para ${candidatoDepois.dados.status}`);
    const oportunidadeDepois = await api("GET", `/admin/oportunidades/${oportunidadeB}`, { token: admin });
    confere(oportunidadeDepois.dados.status === "RASCUNHO", `oportunidade de volta a ${oportunidadeDepois.dados.status}`);
    const naBusca = await api("GET", `/web/oportunidades/${oportunidadeB}`);
    confere(naBusca.status === 404, `não aparece no modelo de leitura (GET público → ${naBusca.status})`);
  }

  titulo("Encerramento: evento remove do modelo de leitura e avisa quem salvou");
  const encerramento = await api("POST", `/admin/oportunidades/${oportunidadeA}/encerramento`, { token: admin });
  confere(encerramento.status === 200 && encerramento.dados.status === "ENCERRADA", `POST .../encerramento → ${encerramento.dados?.status}`);
  let sumiu = false;
  let avisos;
  for (let i = 0; i < 20 && !(sumiu && avisos?.dados.total > 0); i++) {
    await esperar(250);
    sumiu = (await api("GET", `/web/oportunidades/${oportunidadeA}`)).status === 404;
    avisos = await api("GET", "/web/notificacoes", { token: estudante });
  }
  confere(sumiu, "removida da busca pública (projetor)");
  confere(avisos.dados.total > 0, `aviso in-app criado pelo Engajamento: "${avisos.dados.itens[0]?.mensagem}"`);

  console.log(`\n${falhas === 0 ? "Tudo certo" : `${falhas} verificação(ões) falharam`}.`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((erro) => {
  console.error(`\nFalha na demonstração: ${erro.message}`);
  process.exit(1);
});
