import { criarLog, transacao, type Pool, type Publicador } from "@conectau/comum";

const log = criarLog("oportunidades");

interface LinhaOutbox {
  id: string;
  tipo: string;
  chave: string;
  payload: Record<string, unknown>;
  criado_em: Date;
}

/**
 * Relay da Transactional Outbox: a cada segundo publica no RabbitMQ os eventos ainda não enviados.
 * Se o broker estiver fora, a transação é desfeita e os eventos continuam na outbox até ele voltar.
 * A entrega é at-least-once (um evento pode sair duas vezes); os consumidores são idempotentes.
 */
export function iniciarRelay(pool: Pool, publicador: Publicador): () => void {
  let rodando = false;
  let brokerFora = false;

  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const enviados = await transacao(pool, async (cliente) => {
        const { rows } = await cliente.query<LinhaOutbox>(
          `SELECT id, tipo, chave, payload, criado_em FROM outbox
            WHERE enviado_em IS NULL ORDER BY criado_em LIMIT 50
            FOR UPDATE SKIP LOCKED`
        );
        for (const linha of rows) {
          await publicador.publicar(linha.chave, {
            messageId: linha.id,
            tipo: linha.tipo,
            ocorridoEm: linha.criado_em.toISOString(),
            payload: linha.payload
          });
          await cliente.query("UPDATE outbox SET enviado_em = now() WHERE id = $1", [linha.id]);
        }
        return rows.length;
      });
      if (brokerFora) log.info("RabbitMQ de volta; relay da outbox retomado");
      brokerFora = false;
      if (enviados > 0) log.info(`Relay publicou ${enviados} evento(s) da outbox`);
    } catch (erro) {
      if (!brokerFora) {
        log.aviso("Relay não conseguiu publicar; eventos permanecem na outbox", { erro: (erro as Error).message });
      }
      brokerFora = true;
    } finally {
      rodando = false;
    }
  };

  const temporizador = setInterval(() => void ciclo(), 1000);
  return () => clearInterval(temporizador);
}
