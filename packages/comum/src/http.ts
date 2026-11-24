import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ErroChamada } from "./cliente.js";
import { ErroHttp, erros } from "./erros.js";
import { criarLog } from "./log.js";

export type VerificacaoSaude = () => Promise<Record<string, unknown>>;

/**
 * Cria o app Express padrão dos serviços: JSON, X-Request-Id, log de acesso e /health.
 * O /health responde 503 quando uma dependência obrigatória (ex.: o banco) está fora,
 * o que faz o healthcheck do Docker e a readinessProbe do Kubernetes refletirem o estado real.
 */
export function criarApp(servico: string, verificarSaude?: VerificacaoSaude): Express {
  const log = criarLog(servico);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header("x-request-id") || randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const inicio = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.path === "/health") return;
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      log.info(`${req.method} ${req.originalUrl} ${res.statusCode}`, { requestId, ms: Math.round(ms) });
    });
    next();
  });

  app.get("/health", async (_req, res) => {
    try {
      const detalhes = verificarSaude ? await verificarSaude() : {};
      res.json({ servico, status: "operacional", ...detalhes });
    } catch (erro) {
      res.status(503).json({ servico, status: "indisponivel", erro: (erro as Error).message });
    }
  });

  return app;
}

/** Deve ser chamado depois de registrar as rotas: adiciona 404 e o tratador de erros. */
export function finalizarApp(app: Express, servico: string): void {
  const log = criarLog(servico);
  app.use((_req: Request, _res: Response, next: NextFunction) => next(erros.naoEncontrado("Rota não encontrada")));
  app.use((erro: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (erro instanceof ErroHttp) {
      res.status(erro.status).json({ codigo: erro.codigo, mensagem: erro.message });
      return;
    }
    if (erro instanceof ErroChamada) {
      // Erro de outro serviço: 4xx é repassado como veio; falha de rede ou 5xx vira 503.
      if (erro.definitivo && erro.status !== undefined) {
        res.status(erro.status).json(corpoDeErro(erro.corpo, erro.message));
        return;
      }
      log.aviso("Dependência indisponível", { erro: erro.message });
      res.status(503).json({ codigo: "SERVICO_INDISPONIVEL", mensagem: "Um serviço interno está indisponível" });
      return;
    }
    const tipo = (erro as { type?: string } | null)?.type;
    if (tipo === "entity.parse.failed") {
      res.status(400).json({ codigo: "REQUISICAO_INVALIDA", mensagem: "JSON malformado" });
      return;
    }
    log.erro("Erro não tratado", { erro: erro instanceof Error ? (erro.stack ?? erro.message) : String(erro) });
    res.status(500).json({ codigo: "ERRO_INTERNO", mensagem: "Erro interno" });
  });
}

function corpoDeErro(corpo: unknown, padrao: string): { codigo: string; mensagem: string } {
  if (typeof corpo === "object" && corpo !== null && "codigo" in corpo && "mensagem" in corpo) {
    const { codigo, mensagem } = corpo as { codigo: unknown; mensagem: unknown };
    return { codigo: String(codigo), mensagem: String(mensagem) };
  }
  return { codigo: "ERRO_DEPENDENCIA", mensagem: padrao };
}

/** Sobe o servidor e trata SIGTERM/SIGINT (enviados por `docker stop` e pelo Kubernetes). */
export function iniciar(app: Express, porta: number, servico: string, aoEncerrar?: () => Promise<void>): Server {
  const log = criarLog(servico);
  const servidor = app.listen(porta, () => log.info(`Serviço ${servico} ouvindo na porta ${porta}`));
  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    log.info(`Recebido ${sinal}; encerrando`);
    servidor.close();
    try {
      await aoEncerrar?.();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void encerrar("SIGTERM"));
  process.on("SIGINT", () => void encerrar("SIGINT"));
  return servidor;
}

export function requestIdDe(res: Response): string {
  return String(res.locals.requestId ?? "");
}
