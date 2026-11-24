import pg from "pg";
import { variavel, variavelNumero } from "./util.js";

export type Pool = pg.Pool;
export type ClienteBanco = pg.PoolClient;

/**
 * Cria o pool de conexões a partir de variáveis de ambiente.
 * `prefixo` permite que um serviço tenha mais de um banco (ex.: LEITURA_DB_HOST no CQRS).
 */
export function criarPool(prefixo = ""): Pool {
  return new pg.Pool({
    host: variavel(`${prefixo}DB_HOST`),
    port: variavelNumero(`${prefixo}DB_PORTA`, 5432),
    database: variavel(`${prefixo}DB_NOME`),
    user: variavel(`${prefixo}DB_USUARIO`),
    password: variavel(`${prefixo}DB_SENHA`),
    max: variavelNumero(`${prefixo}DB_MAX_CONEXOES`, 10),
    connectionTimeoutMillis: 3000
  });
}

export async function transacao<T>(pool: Pool, trabalho: (cliente: ClienteBanco) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await trabalho(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Verificação usada pelo /health. */
export async function verificarBanco(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
