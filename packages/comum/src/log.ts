type Nivel = "info" | "aviso" | "erro";

/** Log estruturado em JSON (uma linha por evento), lido por `docker compose logs` e `kubectl logs`. */
export function registrar(servico: string, nivel: Nivel, mensagem: string, extra: Record<string, unknown> = {}): void {
  const linha = JSON.stringify({ ts: new Date().toISOString(), servico, nivel, mensagem, ...extra });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}

export function criarLog(servico: string) {
  return {
    info: (mensagem: string, extra?: Record<string, unknown>) => registrar(servico, "info", mensagem, extra),
    aviso: (mensagem: string, extra?: Record<string, unknown>) => registrar(servico, "aviso", mensagem, extra),
    erro: (mensagem: string, extra?: Record<string, unknown>) => registrar(servico, "erro", mensagem, extra)
  };
}

export type Log = ReturnType<typeof criarLog>;
