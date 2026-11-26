// Provoca (e desfaz) falhas no provedor de LLM do Assistente, para demonstrar ao vivo o fallback, as
// retentativas e o disjuntor (circuit breaker).
//
//   node scripts/falha-llm.mjs on                 toda chamada ao provedor passa a falhar (503)
//   node scripts/falha-llm.mjs lento=30000        cada chamada demora 30 s (estoura o timeout)
//   node scripts/falha-llm.mjs off                volta ao normal
//   node scripts/falha-llm.mjs status             estado do disjuntor e métricas de latência e custo
//   (acrescente --ambiente=k8s para o Kubernetes; o padrão é o Docker Compose)
//
// A rota /internal do Assistente não é publicada no gateway, então o script executa o pedido de dentro
// do container (docker compose exec / kubectl exec), usando o TOKEN_SERVICO que o próprio container já tem.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function chamarAssistente({ ambiente = "compose", metodo = "GET", caminho, corpo }) {
  const codigo =
    "const o={method:" + JSON.stringify(metodo) + ",headers:{'content-type':'application/json','x-token-servico':process.env.TOKEN_SERVICO}};" +
    (corpo ? "o.body=" + JSON.stringify(JSON.stringify(corpo)) + ";" : "") +
    "fetch('http://127.0.0.1:3105'+" + JSON.stringify(caminho) + ",o).then(r=>r.text()).then(t=>process.stdout.write(t))";
  const [comando, argumentos] =
    ambiente === "k8s"
      ? ["kubectl", ["exec", "-n", "conectau", "deploy/assistente", "--", "node", "-e", codigo]]
      : ["docker", ["compose", "exec", "-T", "assistente", "node", "-e", codigo]];
  return JSON.parse(execFileSync(comando, argumentos, { encoding: "utf8" }));
}

export const simularFalhaDoLlm = (ambiente, corpo) =>
  chamarAssistente({ ambiente, metodo: "PUT", caminho: "/internal/llm/simulacao", corpo });

export const estadoDoLlm = (ambiente, horas = 1) => chamarAssistente({ ambiente, caminho: `/internal/llm?horas=${horas}` });

function resumir(estado) {
  const d = estado.disjuntor;
  console.log(`LLM: ${estado.configurado ? `configurado (${estado.modelo})` : "sem GROQ_API_KEY (modo de recuperação)"}`);
  console.log(`Disjuntor: ${d.estado} · falhas na janela: ${d.falhasNaJanela} · aberturas: ${d.aberturas} · chamadas rejeitadas: ${d.rejeitadas}`);
  console.log(`Simulação: falha=${estado.simulacao.falha}, latência=${estado.simulacao.latenciaMs} ms`);
  const m = estado.metricas;
  if (m) {
    console.log(`Últimas ${m.janelaHoras} h: ${m.respostas} respostas (LLM ${m.porOrigem.llm}, cache ${m.porOrigem.cache}, fallback ${m.porOrigem.fallback}); custo estimado US$ ${m.custoEstimadoTotalUsd.toFixed(6)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argumentos = process.argv.slice(2);
  const ambiente = argumentos.find((a) => a.startsWith("--ambiente="))?.split("=")[1] ?? "compose";
  const comando = argumentos.find((a) => !a.startsWith("--")) ?? "status";
  let estado;
  if (comando === "on") estado = simularFalhaDoLlm(ambiente, { falha: true });
  else if (comando === "off") estado = simularFalhaDoLlm(ambiente, { falha: false, latenciaMs: 0 });
  else if (comando.startsWith("lento=")) estado = simularFalhaDoLlm(ambiente, { latenciaMs: Number(comando.split("=")[1]) });
  else if (comando === "status") estado = estadoDoLlm(ambiente);
  else {
    console.error("Uso: node scripts/falha-llm.mjs on|off|lento=<ms>|status [--ambiente=compose|k8s]");
    process.exit(1);
  }
  resumir(estado);
}
