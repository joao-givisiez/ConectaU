import type { NextFunction, Request, Response } from "express";
import {
  cabecalhosDoUsuario,
  chamar,
  criarApp,
  criarLog,
  exigirAdmin,
  finalizarApp,
  idDoCaminho,
  iniciar,
  requestIdDe,
  variavel,
  variavelNumero
} from "@conectau/comum";

/**
 * BFF do Painel Admin (curadoria). Não tem banco nem regra de negócio: agrega Coleta e
 * Oportunidades e entrega o registro completo (procedência, status, passos da SAGA).
 * O gateway já exige role=ADMIN em /admin/**; aqui o papel é verificado de novo (defesa em profundidade).
 */

const SERVICO = "bff-admin";
const PORTA = variavelNumero("PORT", 3202);
const URL = {
  coleta: variavel("COLETA_URL"),
  oportunidades: variavel("OPORTUNIDADES_URL")
};
const log = criarLog(SERVICO);

interface Link {
  href: string;
  method: string;
}

async function repassar(req: Request, res: Response, base: string, caminho: string) {
  const usuario = exigirAdmin(req);
  const indice = req.originalUrl.indexOf("?");
  const query = indice >= 0 ? req.originalUrl.slice(indice) : "";
  const temCorpo = ["POST", "PUT", "PATCH"].includes(req.method);
  const resposta = await chamar<Record<string, unknown>>(`${base}${caminho}${query}`, {
    metodo: req.method,
    cabecalhos: cabecalhosDoUsuario(usuario),
    requestId: requestIdDe(res),
    timeoutMs: 15000,
    ...(temCorpo ? { corpo: req.body ?? {} } : {})
  });
  if (resposta.status === 204) {
    res.status(204).end();
    return;
  }
  res.status(resposta.status).json(reescreverLinks(resposta.corpo));
}

/** Links do serviço → rotas do Painel Admin; ações de estudante não fazem sentido aqui. */
function reescreverLinks<T>(corpo: T): T {
  if (Array.isArray(corpo)) return corpo.map(reescreverLinks) as T;
  if (typeof corpo !== "object" || corpo === null) return corpo;
  const copia: Record<string, unknown> = { ...(corpo as Record<string, unknown>) };
  for (const [chave, valor] of Object.entries(copia)) {
    if (chave === "_links" && typeof valor === "object" && valor !== null) {
      const links: Record<string, Link> = {};
      for (const [relacao, link] of Object.entries(valor as Record<string, Link>)) {
        if (["salvar", "lembrar", "perguntar"].includes(relacao)) continue;
        links[relacao] = { ...link, href: link.href.replace(/^\/api\/v1\//, "/admin/") };
      }
      copia[chave] = links;
    } else if (typeof valor === "object") {
      copia[chave] = reescreverLinks(valor);
    }
  }
  return copia as T;
}

const app = criarApp(SERVICO);
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();
  exigirAdmin(req);
  next();
});

// ---------- Coleta ----------
app.get("/fontes", (req, res) => repassar(req, res, URL.coleta, "/api/v1/fontes"));
app.post("/fontes", (req, res) => repassar(req, res, URL.coleta, "/api/v1/fontes"));
app.get("/execucoes", (req, res) => repassar(req, res, URL.coleta, "/api/v1/execucoes"));
app.post("/execucoes", (req, res) => repassar(req, res, URL.coleta, "/api/v1/execucoes"));
app.get("/candidatos", (req, res) => repassar(req, res, URL.coleta, "/api/v1/candidatos"));
app.post("/candidatos", (req, res) => repassar(req, res, URL.coleta, "/api/v1/candidatos"));
app.get("/candidatos/:id", (req, res) =>
  repassar(req, res, URL.coleta, `/api/v1/candidatos/${idDoCaminho(req.params.id, "Candidato")}`)
);
app.patch("/candidatos/:id", (req, res) =>
  repassar(req, res, URL.coleta, `/api/v1/candidatos/${idDoCaminho(req.params.id, "Candidato")}`)
);

// ---------- Oportunidades ----------
app.get("/oportunidades", (req, res) => repassar(req, res, URL.oportunidades, "/api/v1/oportunidades"));
app.post("/oportunidades", (req, res) => repassar(req, res, URL.oportunidades, "/api/v1/oportunidades"));
app.patch("/oportunidades/:id", (req, res) =>
  repassar(req, res, URL.oportunidades, `/api/v1/oportunidades/${idDoCaminho(req.params.id, "Oportunidade")}`)
);
app.delete("/oportunidades/:id", (req, res) =>
  repassar(req, res, URL.oportunidades, `/api/v1/oportunidades/${idDoCaminho(req.params.id, "Oportunidade")}`)
);
app.post("/oportunidades/:id/encerramento", (req, res) =>
  repassar(req, res, URL.oportunidades, `/api/v1/oportunidades/${idDoCaminho(req.params.id, "Oportunidade")}/encerramento`)
);
app.post("/oportunidades/:id/publicacao", (req, res) =>
  repassar(req, res, URL.oportunidades, `/api/v1/oportunidades/${idDoCaminho(req.params.id, "Oportunidade")}/publicacao`)
);
app.get("/publicacoes/:sagaId", (req, res) =>
  repassar(req, res, URL.oportunidades, `/api/v1/publicacoes/${idDoCaminho(req.params.sagaId, "Publicação")}`)
);

/**
 * Registro completo de uma oportunidade: dados (modelo de escrita) + procedência (Coleta)
 * + estado da última SAGA. Se a Coleta falhar, a procedência sai como indisponível.
 */
app.get("/oportunidades/:id", async (req, res) => {
  const usuario = exigirAdmin(req);
  const id = idDoCaminho(req.params.id, "Oportunidade");
  const base = { cabecalhos: cabecalhosDoUsuario(usuario), requestId: requestIdDe(res), timeoutMs: 5000 };
  const { corpo: oportunidade } = await chamar<Record<string, unknown> & { candidatoId: string; sagaId?: string }>(
    `${URL.oportunidades}/api/v1/oportunidades/${id}`,
    base
  );

  const [candidato, saga] = await Promise.all([
    chamar<Record<string, unknown>>(`${URL.coleta}/api/v1/candidatos/${oportunidade.candidatoId}`, base)
      .then((r) => r.corpo)
      .catch((erro: Error) => {
        log.aviso("Coleta indisponível; procedência omitida", { erro: erro.message });
        return undefined;
      }),
    oportunidade.sagaId
      ? chamar<Record<string, unknown>>(`${URL.oportunidades}/api/v1/publicacoes/${oportunidade.sagaId}`, base)
          .then((r) => r.corpo)
          .catch(() => undefined)
      : Promise.resolve(undefined)
  ]);

  const { candidatoId, sagaId, ...dados } = oportunidade;
  res.json(
    reescreverLinks({
      ...dados,
      origem: candidato
        ? {
            tipo: candidato.origem,
            candidatoId,
            fonteId: candidato.fonteId,
            solicitante: candidato.solicitante,
            urlOrigem: candidato.urlOrigem,
            coletadoEm: candidato.coletadoEm,
            scoreDuplicidade: candidato.scoreDuplicidade,
            statusCandidato: candidato.status
          }
        : { candidatoId, indisponivel: true },
      saga: saga
        ? { id: sagaId, estado: saga.estado, erro: saga.erro, passos: saga.passos }
        : undefined
    })
  );
});

finalizarApp(app, SERVICO);
iniciar(app, PORTA, SERVICO);
