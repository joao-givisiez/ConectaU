import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { erros } from "./erros.js";

export const PAPEIS = ["ESTUDANTE", "ADMIN"] as const;
export type Papel = (typeof PAPEIS)[number];

export interface Usuario {
  id: string;
  papel: Papel;
}

/**
 * A identidade chega em cabeçalhos definidos pelo gateway a partir do JWT (ForwardAuth) e
 * repassados pelos BFFs. O gateway sempre sobrescreve esses cabeçalhos, então o cliente
 * não consegue forjá-los; e os serviços só são alcançáveis pela rede interna.
 */
export function usuarioOpcional(req: Request): Usuario | undefined {
  const id = req.header("x-usuario-id");
  const papel = req.header("x-usuario-papel");
  if (!id) return undefined;
  if (papel !== "ESTUDANTE" && papel !== "ADMIN") return undefined;
  return { id, papel };
}

export function exigirUsuario(req: Request): Usuario {
  const usuario = usuarioOpcional(req);
  if (!usuario) throw erros.naoAutenticado();
  return usuario;
}

export function exigirAdmin(req: Request): Usuario {
  const usuario = exigirUsuario(req);
  if (usuario.papel !== "ADMIN") throw erros.acessoNegado("Operação exclusiva de ADMIN");
  return usuario;
}

/** Cabeçalhos para repassar a identidade do usuário numa chamada interna. */
export function cabecalhosDoUsuario(usuario: Usuario | undefined): Record<string, string> {
  return usuario ? { "X-Usuario-Id": usuario.id, "X-Usuario-Papel": usuario.papel } : {};
}

/** Middleware das rotas /internal/**: exige o segredo compartilhado entre serviços. */
export function exigirTokenServico(tokenEsperado: string) {
  const esperado = Buffer.from(tokenEsperado);
  return (req: Request, _res: Response, next: NextFunction) => {
    const recebido = Buffer.from(req.header("x-token-servico") ?? "");
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
      next(erros.naoAutenticado("Token de serviço inválido"));
      return;
    }
    next();
  };
}
