import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";
import { criarLog } from "./log.js";
import { esperar } from "./util.js";

/** Exchange de eventos de domínio (topic): a routing key é o tipo do evento, ex. oportunidade.publicada. */
export const EXCHANGE_EVENTOS = "conectau.eventos";
/** Exchange para onde vão as mensagens que falharam além do limite de tentativas. */
export const EXCHANGE_MORTAS = "conectau.mortas";

export interface Evento<T = Record<string, unknown>> {
  messageId: string;
  tipo: string;
  ocorridoEm: string;
  payload: T;
}

/** Publicador com confirmação do broker: só retorna depois que o RabbitMQ aceitou a mensagem. */
export class Publicador {
  private conexao: ChannelModel | undefined;
  private canal: ConfirmChannel | undefined;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  private async obterCanal(): Promise<ConfirmChannel> {
    if (this.canal) return this.canal;
    const conexao = await connect(this.url);
    conexao.on("error", () => undefined);
    conexao.on("close", () => {
      this.canal = undefined;
      this.conexao = undefined;
    });
    const canal = await conexao.createConfirmChannel();
    await canal.assertExchange(EXCHANGE_EVENTOS, "topic", { durable: true });
    this.conexao = conexao;
    this.canal = canal;
    return canal;
  }

  async publicar(chave: string, evento: Evento): Promise<void> {
    const canal = await this.obterCanal();
    canal.publish(EXCHANGE_EVENTOS, chave, Buffer.from(JSON.stringify(evento)), {
      persistent: true,
      messageId: evento.messageId,
      type: evento.tipo,
      contentType: "application/json",
      timestamp: Date.now()
    });
    await canal.waitForConfirms();
  }

  get conectado(): boolean {
    return this.canal !== undefined;
  }

  async fechar(): Promise<void> {
    await this.conexao?.close().catch(() => undefined);
  }
}

export interface OpcoesConsumo {
  url: string;
  servico: string;
  fila: string;
  chaves: string[];
  /** Tentativas antes de mandar a mensagem para a fila de mortas (dead letter queue). */
  maximoTentativas?: number;
}

export type Tratador = (evento: Evento) => Promise<void>;

/**
 * Consumidor resiliente: reconecta se o broker cair, retenta mensagens com falha
 * (até `maximoTentativas`) e depois as envia para `<fila>.mortas`, sem bloquear a fila.
 */
export class Consumidor {
  private canal: Channel | undefined;
  private conexao: ChannelModel | undefined;
  private encerrado = false;
  private readonly opcoes: Required<OpcoesConsumo>;
  private readonly log;

  constructor(opcoes: OpcoesConsumo) {
    this.opcoes = { maximoTentativas: 3, ...opcoes };
    this.log = criarLog(opcoes.servico);
  }

  get conectado(): boolean {
    return this.canal !== undefined;
  }

  /** Inicia em segundo plano; reconecta indefinidamente até `fechar()`. */
  iniciar(tratar: Tratador): void {
    void this.laco(tratar);
  }

  private async laco(tratar: Tratador): Promise<void> {
    while (!this.encerrado) {
      try {
        await this.conectar(tratar);
        return;
      } catch (erro) {
        this.log.aviso("RabbitMQ indisponível; nova tentativa em 5 s", { erro: (erro as Error).message });
        await esperar(5000);
      }
    }
  }

  private async conectar(tratar: Tratador): Promise<void> {
    const { url, fila, chaves } = this.opcoes;
    const conexao = await connect(url);
    conexao.on("error", () => undefined);
    conexao.on("close", () => {
      this.canal = undefined;
      this.conexao = undefined;
      if (!this.encerrado) {
        this.log.aviso("Conexão com o RabbitMQ perdida; reconectando");
        void this.laco(tratar);
      }
    });
    const canal = await conexao.createChannel();
    await canal.prefetch(10);
    await canal.assertExchange(EXCHANGE_EVENTOS, "topic", { durable: true });
    await canal.assertExchange(EXCHANGE_MORTAS, "direct", { durable: true });
    await canal.assertQueue(`${fila}.mortas`, { durable: true });
    await canal.bindQueue(`${fila}.mortas`, EXCHANGE_MORTAS, fila);
    await canal.assertQueue(fila, {
      durable: true,
      deadLetterExchange: EXCHANGE_MORTAS,
      deadLetterRoutingKey: fila
    });
    for (const chave of chaves) await canal.bindQueue(fila, EXCHANGE_EVENTOS, chave);

    await canal.consume(fila, (mensagem) => {
      if (mensagem) void this.processar(canal, mensagem, tratar);
    });
    this.conexao = conexao;
    this.canal = canal;
    this.log.info(`Consumindo a fila ${fila}`, { chaves });
  }

  private async processar(canal: Channel, mensagem: ConsumeMessage, tratar: Tratador): Promise<void> {
    let evento: Evento;
    try {
      evento = JSON.parse(mensagem.content.toString("utf8")) as Evento;
    } catch {
      this.log.erro("Mensagem malformada enviada para a fila de mortas");
      canal.nack(mensagem, false, false);
      return;
    }
    try {
      await tratar(evento);
      canal.ack(mensagem);
    } catch (erro) {
      const tentativa = Number(mensagem.properties.headers?.["x-tentativa"] ?? 1);
      if (tentativa >= this.opcoes.maximoTentativas) {
        this.log.erro("Mensagem esgotou as tentativas; enviada para a fila de mortas", {
          messageId: evento.messageId,
          erro: (erro as Error).message
        });
        canal.nack(mensagem, false, false);
        return;
      }
      this.log.aviso("Falha ao processar mensagem; nova tentativa", {
        messageId: evento.messageId,
        tentativa,
        erro: (erro as Error).message
      });
      await esperar(1000 * tentativa);
      canal.sendToQueue(this.opcoes.fila, mensagem.content, {
        ...mensagem.properties,
        headers: { ...mensagem.properties.headers, "x-tentativa": tentativa + 1 }
      });
      canal.ack(mensagem);
    }
  }

  async fechar(): Promise<void> {
    this.encerrado = true;
    await this.conexao?.close().catch(() => undefined);
  }
}
