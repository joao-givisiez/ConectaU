/** Erro com status HTTP e código no formato do contrato: { codigo, mensagem }. */
export class ErroHttp extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroHttp";
    this.status = status;
    this.codigo = codigo;
  }
}

export const erros = {
  requisicaoInvalida: (mensagem: string) => new ErroHttp(400, "REQUISICAO_INVALIDA", mensagem),
  naoAutenticado: (mensagem = "Autenticação necessária") => new ErroHttp(401, "NAO_AUTENTICADO", mensagem),
  acessoNegado: (mensagem = "Acesso negado") => new ErroHttp(403, "ACESSO_NEGADO", mensagem),
  naoEncontrado: (mensagem: string) => new ErroHttp(404, "RECURSO_NAO_ENCONTRADO", mensagem),
  conflito: (mensagem: string) => new ErroHttp(409, "CONFLITO", mensagem),
  regraDeNegocio: (mensagem: string) => new ErroHttp(422, "REGRA_DE_NEGOCIO", mensagem),
  indisponivel: (mensagem: string) => new ErroHttp(503, "SERVICO_INDISPONIVEL", mensagem)
};
