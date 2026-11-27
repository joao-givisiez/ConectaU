/**
 * Cliente da API do ConectaU. Fala só com o gateway (mesma origem): /auth/**, /web/** e /admin/**.
 *
 * Este módulo não usa window, document nem sessionStorage. Por isso a interface (main.js) e o teste de
 * rotas (tests/rotas.mjs) importam o mesmo arquivo: o que o teste chama é exatamente o que a tela chama.
 */

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, corpo) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.corpo = corpo;
  }
}

const MENSAGEM_POR_STATUS = {
  401: "Sessão expirada. Entre novamente.",
  403: "Você não tem permissão para fazer isto.",
  404: "Não encontramos o que você procurou.",
  429: "Muitas requisições em pouco tempo. Espere um instante e tente de novo.",
  502: "O serviço está indisponível agora. Tente de novo em instantes.",
  503: "O serviço está indisponível agora. Tente de novo em instantes.",
  504: "O serviço demorou demais para responder. Tente de novo."
};

function montarConsulta(consulta) {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries(consulta ?? {})) {
    if (valor === undefined || valor === null || valor === "") continue;
    parametros.set(chave, String(valor));
  }
  const texto = parametros.toString();
  return texto ? `?${texto}` : "";
}

/**
 * @param {object} opcoes
 * @param {string} [opcoes.base]            prefixo (vazio no navegador; "http://localhost:8080" no teste)
 * @param {() => string|null} [opcoes.obterToken]
 * @param {() => void} [opcoes.aoNaoAutenticado]  chamado num 401 de quem estava logado
 * @param {typeof fetch} [opcoes.fetchImpl]
 */
export function criarCliente({ base = "", obterToken = () => null, aoNaoAutenticado = () => {}, fetchImpl } = {}) {
  const buscar = fetchImpl ?? ((...argumentos) => fetch(...argumentos));

  async function requisitar(metodo, caminho, { corpo, consulta, timeoutMs = 15000, semToken = false } = {}) {
    const cabecalhos = { Accept: "application/json" };
    const token = semToken ? null : obterToken();
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";

    const controle = new AbortController();
    const temporizador = setTimeout(() => controle.abort(), timeoutMs);
    let resposta;
    try {
      resposta = await buscar(`${base}${caminho}${montarConsulta(consulta)}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle.signal
      });
    } catch (erro) {
      if (erro?.name === "AbortError") {
        throw new ErroApi(0, "TEMPO_ESGOTADO", "A resposta demorou demais. Tente de novo.");
      }
      throw new ErroApi(0, "SEM_CONEXAO", "Não consegui falar com o servidor. Confira sua conexão.");
    } finally {
      clearTimeout(temporizador);
    }

    // O gateway pode responder texto puro (por exemplo "Too Many Requests"), então nem todo corpo é JSON.
    const texto = await resposta.text();
    let dados;
    if (texto) {
      try {
        dados = JSON.parse(texto);
      } catch {
        dados = undefined;
      }
    }

    if (!resposta.ok) {
      if (resposta.status === 401 && token) aoNaoAutenticado();
      const mensagem = dados?.mensagem ?? MENSAGEM_POR_STATUS[resposta.status] ?? `Erro ${resposta.status}.`;
      throw new ErroApi(resposta.status, dados?.codigo ?? `HTTP_${resposta.status}`, mensagem, dados ?? texto);
    }
    return dados;
  }

  return { requisitar };
}

/** Catálogo das rotas que a interface usa, agrupado pelas três portas do gateway. */
export function criarApi(cliente) {
  const { requisitar } = cliente;
  return {
    auth: {
      entrar: (dados) => requisitar("POST", "/auth/sessoes", { corpo: dados, semToken: true }),
      cadastrar: (dados) => requisitar("POST", "/auth/usuarios", { corpo: dados, semToken: true })
    },

    web: {
      feed: ({ pagina } = {}) => requisitar("GET", "/web/feed", { consulta: { pagina } }),
      oportunidades: (filtros = {}) => requisitar("GET", "/web/oportunidades", { consulta: filtros }),
      oportunidade: (id) => requisitar("GET", `/web/oportunidades/${id}`),

      perfil: () => requisitar("GET", "/web/perfil"),
      atualizarPerfil: (dados) => requisitar("PATCH", "/web/perfil", { corpo: dados }),

      favoritos: (consulta = {}) => requisitar("GET", "/web/favoritos", { consulta: { limite: 50, ...consulta } }),
      salvar: (oportunidadeId) => requisitar("POST", "/web/favoritos", { corpo: { oportunidadeId } }),
      removerFavorito: (id) => requisitar("DELETE", `/web/favoritos/${id}`),

      lembretes: (consulta = {}) => requisitar("GET", "/web/lembretes", { consulta: { limite: 50, ...consulta } }),
      criarLembrete: (oportunidadeId, antecedenciaHoras) =>
        requisitar("POST", "/web/lembretes", { corpo: { oportunidadeId, antecedenciaHoras } }),
      removerLembrete: (id) => requisitar("DELETE", `/web/lembretes/${id}`),

      notificacoes: (consulta = {}) => requisitar("GET", "/web/notificacoes", { consulta: { limite: 50, ...consulta } }),
      marcarComoLida: (id) => requisitar("PATCH", `/web/notificacoes/${id}`, { corpo: { lida: true } }),

      // Assistente. A pergunta pode chamar o LLM e levar dezenas de segundos.
      criarConversa: (oportunidadeId) =>
        requisitar("POST", "/web/conversas", { corpo: oportunidadeId ? { oportunidadeId } : {} }),
      perguntar: (conversaId, pergunta, extras = {}) =>
        requisitar("POST", `/web/conversas/${conversaId}/mensagens`, {
          corpo: { pergunta, ...extras },
          timeoutMs: 70000
        })
    },

    admin: {
      fontes: (consulta = {}) => requisitar("GET", "/admin/fontes", { consulta: { limite: 50, ...consulta } }),
      criarFonte: (dados) => requisitar("POST", "/admin/fontes", { corpo: dados }),
      execucoes: (consulta = {}) => requisitar("GET", "/admin/execucoes", { consulta: { limite: 10, ...consulta } }),
      executarColeta: (fonteId) => requisitar("POST", "/admin/execucoes", { corpo: { fonteId }, timeoutMs: 30000 }),

      candidatos: (consulta = {}) => requisitar("GET", "/admin/candidatos", { consulta: { limite: 50, ...consulta } }),
      candidato: (id) => requisitar("GET", `/admin/candidatos/${id}`),
      registrarCandidato: (dados) => requisitar("POST", "/admin/candidatos", { corpo: dados }),
      atualizarCandidato: (id, status) => requisitar("PATCH", `/admin/candidatos/${id}`, { corpo: { status } }),

      oportunidades: (consulta = {}) => requisitar("GET", "/admin/oportunidades", { consulta: { limite: 50, ...consulta } }),
      oportunidade: (id) => requisitar("GET", `/admin/oportunidades/${id}`),
      criarOportunidade: (dados) => requisitar("POST", "/admin/oportunidades", { corpo: dados }),
      editarOportunidade: (id, dados) => requisitar("PATCH", `/admin/oportunidades/${id}`, { corpo: dados }),
      excluirOportunidade: (id) => requisitar("DELETE", `/admin/oportunidades/${id}`),
      encerrar: (id) => requisitar("POST", `/admin/oportunidades/${id}/encerramento`),
      publicar: (id) => requisitar("POST", `/admin/oportunidades/${id}/publicacao`),
      publicacao: (sagaId) => requisitar("GET", `/admin/publicacoes/${sagaId}`)
    }
  };
}
