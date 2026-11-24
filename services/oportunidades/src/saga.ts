import {
  ErroChamada,
  chamar,
  criarLog,
  transacao,
  type ClienteBanco,
  type Pool
} from "@conectau/comum";
import { COLUNAS, EVENTOS, registrarEvento, type LinhaOportunidade } from "./modelo.js";

/**
 * Orquestrador da SAGA de publicação (ver docs/arquitetura/4.6-saga.md).
 *
 * Passos: 1) RASCUNHO → PUBLICANDO (feito na API, ao criar a SAGA)
 *         2) Coleta consome o candidato
 *         3) Assistente indexa o texto
 *         4) pivô: PUBLICADA + evento na outbox, no mesmo COMMIT
 *
 * O estado de cada passo fica no banco; se o processo reiniciar, a SAGA é retomada
 * do último passo gravado. Com várias réplicas, cada SAGA é reservada com SKIP LOCKED.
 */

const PASSOS_REMOTOS = ["CONSUMIR_CANDIDATO", "INDEXAR_ASSISTENTE"] as const;
type PassoRemoto = (typeof PASSOS_REMOTOS)[number];

interface LinhaSaga {
  id: string;
  oportunidade_id: string;
  estado: string;
}

interface LinhaPasso {
  passo: string;
  estado: string;
  incerto: boolean;
}

export interface ConfigOrquestrador {
  pool: Pool;
  coletaUrl: string;
  assistenteUrl: string;
  tokenServico: string;
  /** Retentativas por passo e espera inicial do backoff (1 s, 2 s, 4 s...). */
  retentativas: number;
  esperaInicialMs: number;
  timeoutMs: number;
}

const log = criarLog("oportunidades");

export class Orquestrador {
  private readonly config: ConfigOrquestrador;
  private executando = false;
  private temporizador: NodeJS.Timeout | undefined;

  constructor(config: ConfigOrquestrador) {
    this.config = config;
  }

  iniciar(): void {
    this.temporizador = setInterval(() => this.acordar(), 1000);
  }

  parar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Processa as SAGAs pendentes; chamado periodicamente e logo após uma nova publicação. */
  acordar(): void {
    if (this.executando) return;
    this.executando = true;
    void this.processarPendentes()
      .catch((erro) => log.erro("Falha no orquestrador", { erro: (erro as Error).message }))
      .finally(() => {
        this.executando = false;
      });
  }

  private async processarPendentes(): Promise<void> {
    for (;;) {
      const saga = await this.reservar();
      if (!saga) return;
      await this.executar(saga);
    }
  }

  private async reservar(): Promise<LinhaSaga | undefined> {
    const { rows } = await this.config.pool.query<LinhaSaga>(
      `UPDATE saga_publicacao SET reservada_ate = now() + interval '2 minutes'
        WHERE id = (SELECT id FROM saga_publicacao
                     WHERE estado IN ('INICIADA', 'EM_ANDAMENTO', 'COMPENSANDO') AND reservada_ate < now()
                     ORDER BY iniciada_em LIMIT 1
                     FOR UPDATE SKIP LOCKED)
        RETURNING id, oportunidade_id, estado`
    );
    return rows[0];
  }

  private async executar(saga: LinhaSaga): Promise<void> {
    const { pool } = this.config;
    const oportunidade = (
      await pool.query<LinhaOportunidade>(`SELECT ${COLUNAS} FROM oportunidades WHERE id = $1`, [saga.oportunidade_id])
    ).rows[0];
    if (!oportunidade) {
      await this.definirEstado(saga.id, "FALHA_COMPENSACAO", "Oportunidade não encontrada");
      return;
    }

    if (saga.estado === "INICIADA" || saga.estado === "EM_ANDAMENTO") {
      await this.definirEstado(saga.id, "EM_ANDAMENTO");
      const passos = await this.lerPassos(saga.id);
      for (const passo of PASSOS_REMOTOS) {
        if (passos.get(passo)?.estado === "OK") continue;
        try {
          log.info(`SAGA ${saga.id}: executando ${passo}`, { sagaId: saga.id, oportunidadeId: oportunidade.id });
          const detalhe = await this.executarPasso(passo, saga.id, oportunidade);
          await this.marcarPasso(saga.id, passo, "OK", detalhe, false);
        } catch (erro) {
          const falha = erro instanceof ErroChamada ? erro : undefined;
          const mensagem = (erro as Error).message;
          await this.marcarPasso(saga.id, passo, "FALHA", mensagem, falha?.incerto ?? false);
          await this.definirEstado(saga.id, "COMPENSANDO", `${passo}: ${mensagem}`);
          log.aviso(`SAGA ${saga.id}: ${passo} falhou; compensando`, { sagaId: saga.id, erro: mensagem });
          await this.compensar(saga.id, oportunidade);
          return;
        }
      }
      await this.concluir(saga.id, oportunidade.id);
      return;
    }

    if (saga.estado === "COMPENSANDO") await this.compensar(saga.id, oportunidade);
  }

  private async executarPasso(passo: PassoRemoto, sagaId: string, o: LinhaOportunidade): Promise<string> {
    const { coletaUrl, assistenteUrl } = this.config;
    if (passo === "CONSUMIR_CANDIDATO") {
      await chamar(`${coletaUrl}/internal/candidatos/${o.candidato_id}/consumo`, {
        ...this.opcoesChamada(sagaId, passo),
        metodo: "POST",
        corpo: { sagaId, oportunidadeId: o.id }
      });
      return "Candidato CONSUMIDO na Coleta";
    }
    const texto = [
      o.titulo,
      o.descricao ?? "",
      `Categoria: ${o.categoria}. Campus: ${o.campus}.`,
      o.data_inicio ? `Início: ${o.data_inicio.toISOString().slice(0, 10)}.` : "",
      `Prazo de inscrição: ${o.prazo_inscricao.toISOString().slice(0, 10)}.`,
      o.tags.length ? `Temas: ${o.tags.join(", ")}.` : ""
    ]
      .filter(Boolean)
      .join("\n");
    const { corpo } = await chamar<{ chunks: number }>(`${assistenteUrl}/internal/indexacoes/${o.id}`, {
      ...this.opcoesChamada(sagaId, passo),
      metodo: "PUT",
      corpo: { sagaId, titulo: o.titulo, texto, fonteUrl: o.fonte_url }
    });
    return `${corpo.chunks} chunks indexados no Assistente`;
  }

  private async compensarPasso(passo: PassoRemoto, sagaId: string, o: LinhaOportunidade): Promise<void> {
    const { coletaUrl, assistenteUrl } = this.config;
    if (passo === "CONSUMIR_CANDIDATO") {
      await chamar(`${coletaUrl}/internal/candidatos/${o.candidato_id}/liberacao`, {
        ...this.opcoesChamada(sagaId, `compensação de ${passo}`),
        metodo: "POST",
        corpo: { sagaId, oportunidadeId: o.id }
      });
      return;
    }
    await chamar(`${assistenteUrl}/internal/indexacoes/${o.id}`, {
      ...this.opcoesChamada(sagaId, `compensação de ${passo}`),
      metodo: "DELETE"
    });
  }

  /** Desfaz, em ordem reversa, os passos concluídos (e os de resultado incerto). */
  private async compensar(sagaId: string, o: LinhaOportunidade): Promise<void> {
    const passos = await this.lerPassos(sagaId);
    for (const passo of [...PASSOS_REMOTOS].reverse()) {
      const atual = passos.get(passo);
      const precisa = atual?.estado === "OK" || (atual?.estado === "FALHA" && atual.incerto);
      if (!precisa) continue;
      try {
        log.info(`SAGA ${sagaId}: compensando ${passo}`, { sagaId });
        await this.compensarPasso(passo, sagaId, o);
        await this.marcarPasso(sagaId, passo, "COMPENSADO", "Compensação aplicada", atual.incerto);
      } catch (erro) {
        const mensagem = `Compensação de ${passo} falhou: ${(erro as Error).message}`;
        await this.definirEstado(sagaId, "FALHA_COMPENSACAO", mensagem, true);
        log.erro(`SAGA ${sagaId}: ${mensagem}; exige intervenção manual`, { sagaId });
        return;
      }
    }
    await transacao(this.config.pool, async (cliente) => {
      await cliente.query(
        "UPDATE oportunidades SET status = 'RASCUNHO', atualizado_em = now() WHERE id = $1 AND status = 'PUBLICANDO'",
        [o.id]
      );
      await this.definirEstado(sagaId, "COMPENSADA", undefined, true, cliente);
    });
    log.info(`SAGA ${sagaId}: COMPENSADA; oportunidade de volta a RASCUNHO`, { sagaId, oportunidadeId: o.id });
  }

  /** Pivô: PUBLICADA + evento na outbox no mesmo COMMIT. Depois disso não há compensação. */
  private async concluir(sagaId: string, oportunidadeId: string): Promise<void> {
    await transacao(this.config.pool, async (cliente) => {
      const { rows } = await cliente.query<LinhaOportunidade>(
        `UPDATE oportunidades
            SET status = 'PUBLICADA', versao = versao + 1, publicada_em = now(), atualizado_em = now()
          WHERE id = $1 AND status = 'PUBLICANDO'
          RETURNING ${COLUNAS}`,
        [oportunidadeId]
      );
      const publicada = rows[0];
      if (!publicada) throw new Error("Oportunidade não está em PUBLICANDO");
      await registrarEvento(cliente, EVENTOS.publicada, publicada);
      await this.marcarPasso(sagaId, "CONCLUIR_PUBLICACAO", "OK", "PUBLICADA e evento gravado na outbox", false, cliente);
      await this.definirEstado(sagaId, "CONCLUIDA", undefined, true, cliente);
    });
    log.info(`SAGA ${sagaId}: CONCLUIDA; oportunidade PUBLICADA`, { sagaId, oportunidadeId });
  }

  private opcoesChamada(sagaId: string, descricao: string) {
    return {
      cabecalhos: { "X-Token-Servico": this.config.tokenServico },
      timeoutMs: this.config.timeoutMs,
      retentativas: this.config.retentativas,
      esperaInicialMs: this.config.esperaInicialMs,
      requestId: sagaId,
      aoRetentar: (tentativa: number, erro: ErroChamada) =>
        log.aviso(`SAGA ${sagaId}: retentativa ${tentativa} de ${descricao}`, { sagaId, erro: erro.message })
    };
  }

  private async lerPassos(sagaId: string): Promise<Map<string, LinhaPasso>> {
    const { rows } = await this.config.pool.query<LinhaPasso>(
      "SELECT passo, estado, incerto FROM saga_passos WHERE saga_id = $1",
      [sagaId]
    );
    return new Map(rows.map((linha) => [linha.passo, linha]));
  }

  private async marcarPasso(
    sagaId: string,
    passo: string,
    estado: string,
    detalhe: string,
    incerto: boolean,
    cliente?: ClienteBanco
  ): Promise<void> {
    await (cliente ?? this.config.pool).query(
      `UPDATE saga_passos SET estado = $3, detalhe = $4, incerto = $5, atualizado_em = now()
        WHERE saga_id = $1 AND passo = $2`,
      [sagaId, passo, estado, detalhe, incerto]
    );
  }

  private async definirEstado(
    sagaId: string,
    estado: string,
    erro?: string,
    final = false,
    cliente?: ClienteBanco
  ): Promise<void> {
    await (cliente ?? this.config.pool).query(
      `UPDATE saga_publicacao
          SET estado = $2, erro = COALESCE($3, erro),
              finalizada_em = CASE WHEN $4 THEN now() ELSE finalizada_em END
        WHERE id = $1`,
      [sagaId, estado, erro ?? null, final]
    );
  }
}
