/**
 * Contexto compartilhado entre as páginas. O main.js preenche; as páginas só leem.
 * Ficar num módulo próprio evita importação circular entre main.js, roteador e páginas.
 */
export const ctx = {
  /** Catálogo de rotas do back-end (js/api.js). */
  api: null,
  /** Navega para uma rota (ex.: "/entrar"). */
  ir: (rota) => {
    location.hash = `#${rota}`;
  },
  /** Reconsulta a quantidade de avisos não lidos e atualiza os contadores do topo. */
  atualizarAvisos: async () => {},
  avisosNaoLidos: 0
};
