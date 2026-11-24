import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;
const TAMANHO = 64;

/** Hash de senha com scrypt e sal aleatório, no formato scrypt$<sal>$<hash> (base64). */
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO);
  return `scrypt$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function conferir(senha: string, armazenado: string): Promise<boolean> {
  const [algoritmo, salBase64, hashBase64] = armazenado.split("$");
  if (algoritmo !== "scrypt" || !salBase64 || !hashBase64) return false;
  const esperado = Buffer.from(hashBase64, "base64");
  const calculado = await scrypt(senha, Buffer.from(salBase64, "base64"), esperado.length);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}
