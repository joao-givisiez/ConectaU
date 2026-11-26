// Avaliação do RAG do ConectaU: compara as respostas COM e SEM recuperação nas perguntas de teste de
// docs/parte-4/perguntas-avaliacao.json e gera o relatório docs/parte-4/avaliacao-rag.md.
//
//   node scripts/avaliar-rag.mjs [--url=http://localhost:8080] [--saida=docs/parte-4/avaliacao-rag.md] [--ritmo=6500]
//   node scripts/avaliar-rag.mjs --relatorio=docs/parte-4/avaliacao-rag.json   (só regera o .md a partir dos resultados salvos)
//
// Para cada pergunta, quatro modos do mesmo endpoint (POST /web/conversas/{id}/mensagens):
//   recuperacao       só a busca vetorial no pgvector, sem LLM (mede a qualidade da recuperação)
//   sem-recuperacao   linha de base: o LLM responde sem nenhum dado do ConectaU
//   rag               cadeia LangChain: recupera os trechos e o LLM responde com base neles
//   agente            agente LangChain (padrão do produto): o LLM decide quais ferramentas usar
// Os modos com LLM precisam de GROQ_API_KEY; sem a chave, o relatório traz só a parte de recuperação.
// O gateway limita o assistente a 10 perguntas por minuto: --ritmo é a pausa entre perguntas (ms).
// Lê ADMIN_EMAIL e ADMIN_SENHA do .env (publica as oportunidades de exemplo, se faltarem).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"])
);
const BASE = argumentos.url ?? "http://localhost:8080";
const SAIDA = argumentos.saida ?? "docs/parte-4/avaliacao-rag.md";
const RITMO_MS = Number(argumentos.ritmo ?? 6500);
const MODOS = ["recuperacao", "sem-recuperacao", "rag", "agente"];
const NOME_DO_MODO = {
  recuperacao: "Só recuperação (sem LLM)",
  "sem-recuperacao": "LLM sem recuperação",
  rag: "Cadeia RAG",
  agente: "Agente (RAG + ferramentas)"
};

const ambiente = { ...lerEnv(".env"), ...process.env };
const conjunto = JSON.parse(readFileSync("docs/parte-4/perguntas-avaliacao.json", "utf8"));
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

async function api(metodo, caminho, { token, corpo } = {}) {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        Accept: "application/json",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (resposta.status === 429) {
      await esperar(8000);
      continue;
    }
    const texto = await resposta.text();
    let dados;
    try {
      dados = texto ? JSON.parse(texto) : undefined;
    } catch {
      dados = texto;
    }
    return { status: resposta.status, dados };
  }
  throw new Error(`Limite de requisições persistente em ${caminho}`);
}

const normalizar = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// ---------------------------------------------------------------- dados de exemplo

/** Textos dos editais fictícios da fonte de exemplo da Coleta (services/coleta/src/exemplo.ts). */
const EDITAIS_DE_EXEMPLO = {
  "Workshop de Docker e Kubernetes": {
    categoria: "EVENTO",
    descricao:
      "Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado."
  },
  "Edital de Monitoria — disciplinas de Exatas": {
    categoria: "BOLSA",
    descricao:
      "Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico."
  },
  "Bolsa de Iniciação Científica em Agricultura Digital": {
    categoria: "BOLSA",
    descricao:
      "Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse."
  }
};

async function publicar(admin, candidato, titulo, descricao, categoria) {
  const inicio = new Date(Date.now() + 20 * 864e5);
  const prazo = new Date(Date.now() + 15 * 864e5);
  const criada = await api("POST", "/admin/oportunidades", {
    token: admin,
    corpo: {
      candidatoId: candidato.id,
      titulo,
      descricao,
      categoria,
      campus: "LAVRAS",
      dataInicio: inicio.toISOString(),
      prazoInscricao: prazo.toISOString(),
      fonteUrl: candidato.urlOrigem,
      tags: []
    }
  });
  if (criada.status !== 201) throw new Error(`Não foi possível criar "${titulo}": ${JSON.stringify(criada.dados)}`);
  const publicacao = await api("POST", `/admin/oportunidades/${criada.dados.id}/publicacao`, { token: admin });
  for (let i = 0; i < 60; i++) {
    const saga = await api("GET", `/admin/publicacoes/${publicacao.dados.sagaId}`, { token: admin });
    if (saga.dados.estado === "CONCLUIDA") return;
    if (["COMPENSADA", "FALHA_COMPENSACAO"].includes(saga.dados.estado)) throw new Error(`SAGA de "${titulo}": ${saga.dados.estado}`);
    await esperar(500);
  }
}

/** Garante que os editais usados nas perguntas estejam publicados (e, portanto, indexados pela SAGA). */
async function garantirEditais(admin) {
  const publicadas = (await api("GET", "/web/oportunidades?limite=100")).dados.itens.map((o) => o.titulo);
  const pendentes = (await api("GET", "/admin/candidatos?status=PENDENTE&limite=100", { token: admin })).dados.itens;
  for (const [titulo, { categoria, descricao }] of Object.entries(EDITAIS_DE_EXEMPLO)) {
    if (publicadas.includes(titulo)) continue;
    let candidato = pendentes.find((c) => c.tituloExtraido === titulo);
    if (!candidato) {
      const manual = await api("POST", "/admin/candidatos", {
        token: admin,
        corpo: { titulo, descricao, urlOrigem: "https://ufla.br/", solicitante: "avaliação do RAG" }
      });
      candidato = manual.dados;
    }
    await publicar(admin, candidato, titulo, descricao, categoria);
    console.log(`   publicada para a avaliação: ${titulo}`);
  }
}

// ---------------------------------------------------------------- avaliação

const ADMITE_QUE_NAO_SABE = /n[aã]o (encontrei|encontrado|h[aá] (essa |esta )?informa|tenho (essa |esta )?informa|consta|aparece|informa|est[aá] (dispon|inform))|sem (essa |esta )?informa|confira (o|no) (canal|edital)/i;

function posicaoDaFonte(resultado, esperada) {
  if (!esperada || !resultado?.fontes) return null;
  const indice = resultado.fontes.findIndex((f) =>
    esperada.documento
      ? f.documento === esperada.documento
      : (f.tipo === "OPORTUNIDADE" || f.tipo === "CATALOGO") && normalizar(f.titulo).includes(normalizar(esperada.oportunidade))
  );
  return indice < 0 ? null : indice + 1;
}

function avaliar(pergunta, resultado) {
  if (!resultado) return undefined;
  const texto = normalizar(resultado.resposta);
  const fatos = pergunta.fatos.map((f) => texto.includes(normalizar(f)));
  return {
    usouLlm: resultado.origem === "LLM" || resultado.origem === "CACHE",
    recusou: resultado.origem === "RECUSA",
    fatosCobertos: fatos.filter(Boolean).length,
    fatosTotal: fatos.length,
    citou: /\[F\d+\]/.test(resultado.resposta),
    admitiuNaoSaber: ADMITE_QUE_NAO_SABE.test(resultado.resposta),
    posicao: posicaoDaFonte(resultado, pergunta.fonteEsperada),
    inventouValor: pergunta.deveAdmitirQueNaoSabe ? /R\$\s?\d/.test(resultado.resposta) : false
  };
}

async function principal() {
  console.log(`Avaliação do RAG em ${BASE} (${conjunto.perguntas.length} perguntas × ${MODOS.length} modos, ritmo ${RITMO_MS} ms)`);
  const admin = (await api("POST", "/auth/sessoes", { corpo: { email: ambiente.ADMIN_EMAIL, senha: ambiente.ADMIN_SENHA } })).dados?.token;
  if (!admin) throw new Error("Login do admin falhou: confira ADMIN_EMAIL e ADMIN_SENHA no .env");
  await garantirEditais(admin);

  const email = `avaliacao-rag-${Date.now()}@conectau.local`;
  await api("POST", "/auth/usuarios", {
    corpo: { nome: "Avaliação do RAG", email, senha: "avaliacao-do-rag-123", curso: "Ciência da Computação", campus: "LAVRAS", interesses: [] }
  });
  const entrar = async () => (await api("POST", "/auth/sessoes", { corpo: { email, senha: "avaliacao-do-rag-123" } })).dados.token;
  let estudante = await entrar();
  // A avaliação leva vários minutos (limite de 10 pedidos por minuto no gateway): renova a sessão se o token expirar.
  const comoEstudante = async (metodo, caminho, corpo) => {
    let r = await api(metodo, caminho, { token: estudante, corpo });
    if (r.status === 401) {
      estudante = await entrar();
      r = await api(metodo, caminho, { token: estudante, corpo });
    }
    return r;
  };
  const minutos = Math.ceil((conjunto.perguntas.length * MODOS.length * 2 * 6.2) / 60);
  console.log(`   duração estimada: ~${minutos} min (cada pergunta abre uma conversa nova, e as duas chamadas contam no limite do gateway)`);

  const resultados = [];
  let modelo;
  for (const pergunta of conjunto.perguntas) {
    const porModo = {};
    for (const modo of MODOS) {
      // Conversa nova a cada pergunta e modo: nenhuma resposta usa o histórico de outra.
      const conversa = (await comoEstudante("POST", "/web/conversas", {})).dados.id;
      const r = await comoEstudante("POST", `/web/conversas/${conversa}/mensagens`, { pergunta: pergunta.pergunta, modo, semCache: true });
      if (r.status !== 201) throw new Error(`${pergunta.id}/${modo}: ${r.status} ${JSON.stringify(r.dados)}`);
      porModo[modo] = r.dados;
      modelo ??= r.dados.modelo;
      process.stdout.write(`   ${pergunta.id} ${modo.padEnd(15)} ${r.dados.origem.padEnd(8)} ${String(r.dados.latenciaMs).padStart(5)} ms\n`);
      await esperar(RITMO_MS);
    }
    resultados.push({ pergunta, porModo, avaliacao: Object.fromEntries(MODOS.map((m) => [m, avaliar(pergunta, porModo[m])])) });
  }

  mkdirSync(dirname(SAIDA), { recursive: true });
  writeFileSync(SAIDA.replace(/\.md$/, ".json"), JSON.stringify({ geradoEm: new Date().toISOString(), base: BASE, modelo, resultados }, null, 2));
  writeFileSync(SAIDA, relatorio(resultados, modelo));
  console.log(`\nRelatório: ${SAIDA}`);
}

// ---------------------------------------------------------------- relatório

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);
const media = (valores) => (valores.length === 0 ? 0 : valores.reduce((s, v) => s + v, 0) / valores.length);
const limpar = (texto) => String(texto ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function relatorio(resultados, modelo) {
  const comLlm = resultados.some((r) => r.avaliacao.agente?.usouLlm);
  const linhas = [];
  linhas.push("# Avaliação do RAG — resultados");
  linhas.push("");
  linhas.push(`> Gerado por \`scripts/avaliar-rag.mjs\` em ${new Date().toISOString().slice(0, 16).replace("T", " ")} (UTC), pelo gateway, com as perguntas de [\`perguntas-avaliacao.json\`](perguntas-avaliacao.json).`);
  linhas.push(`> LLM: ${comLlm ? `\`${modelo}\` (Groq)` : "**não executado** (sem `GROQ_API_KEY`): só a parte de recuperação foi medida"}. Embeddings: \`multilingual-e5-small\` (local). A metodologia e a análise estão em [\`rag-e-agente.md\`](rag-e-agente.md#avaliação-do-rag).`);
  linhas.push("");

  // recuperação
  const avaliaveis = resultados.filter((r) => r.pergunta.fonteEsperada && r.pergunta.tipo !== "catalogo");
  const posicoes = avaliaveis.map((r) => r.avaliacao.recuperacao?.posicao ?? null);
  const hit1 = posicoes.filter((p) => p === 1).length;
  const hit3 = posicoes.filter((p) => p !== null && p <= 3).length;
  const mrr = media(posicoes.map((p) => (p ? 1 / p : 0)));
  linhas.push("## 1. Recuperação (busca vetorial, sem LLM)");
  linhas.push("");
  linhas.push(`Em ${avaliaveis.length} perguntas com fonte conhecida (a de catálogo depende da ferramenta do agente, e a fora do escopo não tem fonte): **acerto no 1º trecho ${pct(hit1, avaliaveis.length)}**, **acerto entre os 3 primeiros ${pct(hit3, avaliaveis.length)}**, MRR ${mrr.toFixed(2)}.`);
  linhas.push("");
  linhas.push("| Pergunta | Fonte esperada | Posição no top 3 | 1º trecho recuperado | Similaridade |");
  linhas.push("|---|---|---|---|---|");
  for (const r of resultados) {
    const rec = r.porModo.recuperacao;
    const esperada = r.pergunta.fonteEsperada ? r.pergunta.fonteEsperada.documento ?? `edital: ${r.pergunta.fonteEsperada.oportunidade}` : "—";
    const posicao = rec?.origem === "RECUSA" ? "recusada (fora do escopo)" : (r.avaliacao.recuperacao?.posicao ?? "não recuperada");
    const primeira = rec?.fontes?.[0];
    linhas.push(`| ${r.pergunta.id} ${limpar(r.pergunta.pergunta)} | ${limpar(esperada)} | ${posicao} | ${limpar(primeira?.titulo ?? "—")} | ${primeira?.similaridade ?? "—"} |`);
  }
  linhas.push("");

  // comparação
  linhas.push("## 2. Com e sem recuperação");
  linhas.push("");
  if (!comLlm) {
    linhas.push("> Esta seção é preenchida quando o script roda com `GROQ_API_KEY` configurada. Sem a chave, os modos com LLM respondem em modo degradado e não há o que comparar.");
    linhas.push("");
  }
  linhas.push("| Modo | Respostas do LLM | Fatos esperados presentes | Citou fontes | Admitiu não saber (P10) | Recusou fora do escopo (P11) | Latência média | Tokens médios (entrada/saída) | Custo médio |");
  linhas.push("|---|---|---|---|---|---|---|---|---|");
  for (const modo of MODOS) {
    const doModo = resultados.map((r) => ({ r, a: r.avaliacao[modo], d: r.porModo[modo] }));
    const respondidas = doModo.filter((x) => x.a?.usouLlm);
    // Nos modos com LLM, só contam as respostas que o LLM gerou (o fallback é só recuperação).
    const consideradas = modo === "recuperacao" ? doModo : respondidas;
    const fatos = consideradas.reduce((s, x) => s + (x.a?.fatosCobertos ?? 0), 0);
    const fatosTotal = consideradas.reduce((s, x) => s + (x.a?.fatosTotal ?? 0), 0);
    const p10 = doModo.find((x) => x.r.pergunta.deveAdmitirQueNaoSabe);
    const p11 = doModo.find((x) => x.r.pergunta.deveRecusar);
    const medidas = respondidas.map((x) => x.d);
    linhas.push(
      `| ${NOME_DO_MODO[modo]} | ${modo === "recuperacao" ? "—" : `${respondidas.length}/${doModo.length}`} | ${pct(fatos, fatosTotal)} | ${modo === "recuperacao" ? "—" : pct(respondidas.filter((x) => x.a.citou).length, respondidas.length)} | ${p10?.a?.usouLlm ? (p10.a.admitiuNaoSaber && !p10.a.inventouValor ? "sim" : "não") : "—"} | ${p11?.a?.recusou ? "sim" : "não"} | ${medidas.length ? `${Math.round(media(medidas.map((d) => d.latenciaMs)))} ms` : `${Math.round(media(doModo.map((x) => x.d.latenciaMs)))} ms`} | ${medidas.length ? `${Math.round(media(medidas.map((d) => d.tokens.entrada)))} / ${Math.round(media(medidas.map((d) => d.tokens.saida)))}` : "—"} | ${medidas.length ? `US$ ${media(medidas.map((d) => d.custoEstimadoUsd)).toFixed(6)}` : "—"} |`
    );
  }
  linhas.push("");
  linhas.push("\"Fatos esperados presentes\" conta, em todas as perguntas, quantos fatos da lista `fatos` aparecem no texto da resposta (busca de texto, sem acento). No modo \"só recuperação\" a resposta é o próprio texto dos trechos devolvidos.");
  linhas.push("");

  // pergunta a pergunta
  linhas.push("## 3. Pergunta a pergunta");
  linhas.push("");
  for (const r of resultados) {
    linhas.push(`### ${r.pergunta.id} — ${r.pergunta.pergunta}`);
    linhas.push("");
    linhas.push(`*${r.pergunta.porque}*`);
    linhas.push("");
    linhas.push("| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |");
    linhas.push("|---|---|---|---|---|---|---|");
    for (const modo of MODOS) {
      const d = r.porModo[modo];
      const a = r.avaliacao[modo];
      linhas.push(
        `| ${NOME_DO_MODO[modo]} | ${d.origem}${d.motivoDegradacao ? ` (${d.motivoDegradacao})` : ""} | ${a.fatosTotal ? `${a.fatosCobertos}/${a.fatosTotal}` : "—"} | ${a.citou ? "sim" : "não"} | ${a.posicao ?? "—"} | ${(d.ferramentas ?? []).map((f) => f.nome).join(", ") || "—"} | ${d.latenciaMs} ms |`
      );
    }
    linhas.push("");
    linhas.push("<details><summary>Respostas</summary>");
    linhas.push("");
    for (const modo of MODOS) {
      linhas.push(`**${NOME_DO_MODO[modo]}:** ${limpar(r.porModo[modo].resposta).slice(0, 900)}`);
      linhas.push("");
    }
    linhas.push("</details>");
    linhas.push("");
  }
  return linhas.join("\n");
}

if (argumentos.relatorio) {
  const salvo = JSON.parse(readFileSync(argumentos.relatorio, "utf8"));
  writeFileSync(SAIDA, relatorio(salvo.resultados, salvo.modelo));
  console.log(`Relatório regerado: ${SAIDA}`);
  process.exit(0);
}

principal().catch((erro) => {
  console.error(`\nFalha na avaliação: ${erro.message}`);
  process.exit(1);
});
