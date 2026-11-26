// Simulador local da API de chat da Groq (formato OpenAI), SOMENTE PARA TESTES E ENSAIOS.
//
//   node scripts/groq-simulado.mjs [--porta=4010] [--latencia=300]
//
// Serve para testar o Assistente sem gastar tokens nem depender da internet: o agente LangChain fala
// com este servidor como falaria com a Groq (chamadas de ferramenta, resposta final, contagem de tokens)
// e dá para provocar falhas (429, 503, 401, lentidão) e ver o disjuntor, as retentativas e o fallback.
// As respostas são montadas a partir dos trechos que o próprio Assistente enviou; NÃO são de um LLM
// e não servem para avaliar a qualidade das respostas.
//
// Para usar com o Docker Compose, no .env:
//   GROQ_API_KEY=qualquer-coisa
//   GROQ_BASE_URL=http://host.docker.internal:4010
//
// Controle em tempo de execução:
//   GET  /controle                       contadores de chamadas
//   PUT  /controle {"modo":"503"}        modo: normal | 503 | 429 | 401 | lento
//   PUT  /controle {"falhasAntes":2,"modo":"429"}   falha só as próximas 2 chamadas, depois volta ao normal
import { createServer } from "node:http";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"])
);
const PORTA = Number(argumentos.porta ?? 4010);
const LATENCIA_BASE_MS = Number(argumentos.latencia ?? 300);

const controle = { modo: "normal", falhasAntes: 0, modoTemporario: "normal" };
const contadores = { chamadas: 0, comFerramentas: 0, falhas: 0, ultimosModelos: [] };

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const tokens = (texto) => Math.ceil(texto.length / 4);

function textoDe(mensagem) {
  if (typeof mensagem.content === "string") return mensagem.content;
  if (Array.isArray(mensagem.content)) return mensagem.content.map((p) => p.text ?? "").join("");
  return "";
}

/** Escolhe a ferramenta como um modelo faria: catálogo para perguntas sobre "o que existe", base para o resto. */
function decidirFerramenta(pergunta, ferramentas) {
  const nomes = ferramentas.map((f) => f.function.name);
  const minuscula = pergunta.toLowerCase();
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad)/.test(minuscula.trim())) return undefined;
  if (/(receita de bolo|futebol|previs[aã]o do tempo|bitcoin)/.test(minuscula)) return undefined;
  const querCatalogo =
    /(quais|que oportunidades|tem alguma|est[aã]o abertas|abertas|fecha|prazo mais|campus|o que tem|listar)/.test(minuscula) &&
    nomes.includes("buscar_oportunidades");
  if (querCatalogo) {
    const argumentos = {};
    if (/lavras/.test(minuscula) && !/paraiso|paraíso/.test(minuscula)) argumentos.campus = "LAVRAS";
    if (/para[ií]so/.test(minuscula)) argumentos.campus = "SAO_SEBASTIAO_DO_PARAISO";
    if (/bolsa/.test(minuscula)) argumentos.categoria = "BOLSA";
    else if (/evento|workshop|minicurso|semana/.test(minuscula)) argumentos.categoria = "EVENTO";
    else if (/processo seletivo/.test(minuscula)) argumentos.categoria = "PROCESSO_SELETIVO";
    const tema = minuscula.match(/(docker|kubernetes|python|dados|monitoria|pesquisa|computa[cç][aã]o)/);
    if (tema) argumentos.busca = tema[1];
    return { nome: "buscar_oportunidades", argumentos };
  }
  if (nomes.includes("consultar_base_conhecimento")) {
    return { nome: "consultar_base_conhecimento", argumentos: { pergunta } };
  }
  return undefined;
}

function respostaFinalComFerramentas(mensagens) {
  const resultados = mensagens.filter((m) => m.role === "tool").map(textoDe);
  const ultimo = resultados.at(-1) ?? "";
  const rotulos = [...new Set([...ultimo.matchAll(/\[(F\d+)\]/g)].map((m) => m[1]))].slice(0, 2);
  const primeiroTrecho = ultimo
    .split("\n")
    .filter((l) => l && !l.startsWith("[F") && !l.startsWith("id:") && !/^\d+ de \d+/.test(l))
    .slice(0, 2)
    .join(" ")
    .slice(0, 380);
  if (!rotulos.length || /^Nenhum|^Erro/.test(ultimo)) {
    return "Não encontrei essa informação nas fontes consultadas. Confira o canal oficial da oportunidade.";
  }
  return `(resposta simulada) Com base nas fontes consultadas: ${primeiroTrecho} ${rotulos.map((r) => `[${r}]`).join(" ")}`;
}

function respostaRag(mensagens) {
  const sistema = textoDe(mensagens.find((m) => m.role === "system") ?? {});
  const contexto = sistema.split("Trechos:")[1] ?? "";
  const rotulo = contexto.match(/\[(F\d+)\]/)?.[1];
  const trecho = contexto.split("\n").filter((l) => l && !l.startsWith("[F")).slice(0, 2).join(" ").slice(0, 380);
  if (!rotulo) return "Não encontrei essa informação nos trechos fornecidos.";
  return `(resposta simulada) Segundo os trechos recuperados: ${trecho} [${rotulo}]`;
}

async function tratarChat(corpo, res) {
  contadores.chamadas++;
  contadores.ultimosModelos.push(corpo.model);
  contadores.ultimosModelos = contadores.ultimosModelos.slice(-5);

  let modo = controle.modo;
  if (controle.falhasAntes > 0) {
    modo = controle.modoTemporario;
    controle.falhasAntes--;
  }
  if (modo === "lento") await dormir(60_000);
  await dormir(LATENCIA_BASE_MS);
  const falhas = { 503: [503, "Service Unavailable"], 429: [429, "Rate limit reached"], 401: [401, "Invalid API Key"] };
  if (falhas[modo]) {
    contadores.falhas++;
    const [status, mensagem] = falhas[modo];
    res.writeHead(status, { "Content-Type": "application/json", ...(status === 429 ? { "retry-after": "1" } : {}) });
    res.end(JSON.stringify({ error: { message: mensagem, type: "error", code: String(status) } }));
    return;
  }

  const mensagens = corpo.messages ?? [];
  const ferramentas = corpo.tools ?? [];
  const entradaTotal = mensagens.map(textoDe).join("\n") + JSON.stringify(ferramentas);
  const ultimaPergunta = textoDe([...mensagens].reverse().find((m) => m.role === "user") ?? {});
  const jaChamouFerramenta = mensagens.some((m) => m.role === "tool");

  let mensagem;
  let finalizacao = "stop";
  if (ferramentas.length > 0) {
    contadores.comFerramentas++;
    const escolha = jaChamouFerramenta ? undefined : decidirFerramenta(ultimaPergunta, ferramentas);
    if (escolha) {
      finalizacao = "tool_calls";
      mensagem = {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: `call_${Math.random().toString(36).slice(2, 10)}`,
            type: "function",
            function: { name: escolha.nome, arguments: JSON.stringify(escolha.argumentos) }
          }
        ]
      };
    } else {
      const texto = jaChamouFerramenta
        ? respostaFinalComFerramentas(mensagens)
        : "Olá! Posso ajudar com oportunidades da UFLA e com o funcionamento do ConectaU. O que você quer saber?";
      mensagem = { role: "assistant", content: texto };
    }
  } else if (textoDe(mensagens.find((m) => m.role === "system") ?? {}).includes("Trechos:")) {
    mensagem = { role: "assistant", content: respostaRag(mensagens) };
  } else {
    mensagem = {
      role: "assistant",
      content: "(resposta simulada, sem recuperação) Não tenho informações específicas sobre isso; em geral, confira o edital oficial."
    };
  }

  const saida = mensagem.content + JSON.stringify(mensagem.tool_calls ?? "");
  const prompt = tokens(entradaTotal);
  const completion = tokens(saida);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: corpo.model,
      choices: [{ index: 0, message: mensagem, finish_reason: finalizacao }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
    })
  );
}

async function lerCorpo(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  const texto = Buffer.concat(partes).toString("utf8");
  return texto ? JSON.parse(texto) : {};
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/openai/v1/chat/completions") {
      return await tratarChat(await lerCorpo(req), res);
    }
    if (url.pathname === "/controle") {
      if (req.method === "PUT") {
        const dados = await lerCorpo(req);
        if (dados.falhasAntes) {
          controle.falhasAntes = Number(dados.falhasAntes);
          controle.modoTemporario = dados.modo ?? "503";
        } else if (dados.modo) {
          controle.modo = dados.modo;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ controle, contadores }));
    }
    res.writeHead(404).end();
  } catch (erro) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(erro) } }));
  }
}).listen(PORTA, () => console.log(`Groq simulado em http://localhost:${PORTA} (latência base ${LATENCIA_BASE_MS} ms)`));
