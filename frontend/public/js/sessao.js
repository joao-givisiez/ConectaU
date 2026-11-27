/**
 * Sessão do usuário. O token fica em sessionStorage (some ao fechar a aba) e o nome vem do próprio
 * JWT, que a Identidade assina com os campos `sub`, `papel` e `nome`. A assinatura NÃO é conferida aqui:
 * isso é só para mostrar o nome. Quem confere o token é o gateway, a cada requisição.
 */

const CHAVE = "conectau.sessao";
const ouvintes = new Set();
let atual = ler();

function ler() {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const sessao = JSON.parse(bruto);
    if (!sessao?.token || (sessao.expiraEm && Date.parse(sessao.expiraEm) <= Date.now())) return null;
    return sessao;
  } catch {
    return null;
  }
}

function gravar(sessao) {
  try {
    if (sessao) sessionStorage.setItem(CHAVE, JSON.stringify(sessao));
    else sessionStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: a sessão dura só até recarregar a página */
  }
}

function nomeDoToken(token) {
  try {
    const carga = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      [...atob(carga)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
    return JSON.parse(json).nome ?? "";
  } catch {
    return "";
  }
}

export const sessao = () => atual;
export const token = () => atual?.token ?? null;
export const estaLogado = () => atual !== null;
export const ehAdmin = () => atual?.papel === "ADMIN";

export function iniciarSessao({ token: jwt, papel, usuarioId, expiraEm }) {
  atual = { token: jwt, papel, usuarioId, expiraEm, nome: nomeDoToken(jwt) };
  gravar(atual);
  ouvintes.forEach((ouvinte) => ouvinte(atual));
}

/** Depois de editar o perfil, o token ainda carrega o nome antigo; guarda o novo só para exibição. */
export function atualizarNome(nome) {
  if (!atual) return;
  atual = { ...atual, nome };
  gravar(atual);
  ouvintes.forEach((ouvinte) => ouvinte(atual));
}

export function encerrarSessao() {
  atual = null;
  gravar(null);
  ouvintes.forEach((ouvinte) => ouvinte(null));
}

export function aoMudarSessao(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
