import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chamar, type Pool } from "@conectau/comum";
import type { ProvedorEmbeddings } from "./embeddings.js";
import { formatarTrechos, recuperar, type Trecho } from "./recuperacao.js";
import type { ContextoPergunta, FonteConsultada } from "./tipos.js";

/**
 * Ferramentas (tools) do agente. São somente de LEITURA e só tocam dados públicos:
 *  - consultar_base_conhecimento: busca vetorial (RAG) na base de conhecimento e nos editais indexados;
 *  - buscar_oportunidades / detalhar_oportunidade: consultam o modelo de leitura do serviço
 *    Oportunidades, ou seja, os dados reais e atuais do sistema.
 * Nenhuma ferramenta acessa perfil, favoritos ou lembretes: o Assistente não vê dados pessoais.
 */
export interface DependenciasFerramentas {
  pool: Pool;
  embeddings: ProvedorEmbeddings;
  oportunidadesUrl: string;
}

const CAMPI = ["LAVRAS", "SAO_SEBASTIAO_DO_PARAISO"] as const;
const CATEGORIAS = ["EVENTO", "ATIVIDADE", "BOLSA", "PROJETO", "PROCESSO_SELETIVO"] as const;

interface OportunidadePublica {
  id: string;
  titulo: string;
  descricao?: string;
  categoria: string;
  campus: string;
  dataInicio?: string;
  prazoInscricao: string;
  fonteUrl: string;
  tags?: string[];
}

const MS_POR_DIA = 24 * 3600 * 1000;

function cortar(textoCompleto: string, limite: number): string {
  const limpo = textoCompleto.replace(/\s+/g, " ").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

function dia(iso: string): string {
  return iso.slice(0, 10);
}

function descreverPrazo(iso: string): string {
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / MS_POR_DIA);
  if (dias < 0) return `${dia(iso)} (prazo já encerrado)`;
  if (dias === 0) return `${dia(iso)} (termina hoje)`;
  return `${dia(iso)} (faltam ${dias} dia${dias === 1 ? "" : "s"})`;
}

/** Palavras da busca viram um "ou": a busca textual devolve primeiro as que casam com mais termos. */
function termosDeBusca(busca: string): string {
  const palavras = busca
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  return palavras.length > 1 ? palavras.join(" or ") : (palavras[0] ?? busca);
}

/** Registra as fontes consultadas na pergunta e devolve os rótulos [F#] (repetindo o de quem já foi visto). */
export function criarRegistroDeFontes(ctx: ContextoPergunta) {
  const jaVistas = new Map<string, string>();
  return (fontes: Omit<FonteConsultada, "id" | "citada">[], chaves: string[]): string[] =>
    fontes.map((fonte, i) => {
      const chave = chaves[i] ?? `${fonte.tipo}|${fonte.titulo}`;
      const existente = jaVistas.get(chave);
      if (existente) return existente;
      const id = `F${ctx.fontes.length + 1}`;
      ctx.fontes.push({ ...fonte, id, citada: false });
      jaVistas.set(chave, id);
      return id;
    });
}

export function chaveDoTrecho(t: Trecho): string {
  return `${t.tipo}|${t.referencia}|${t.texto.slice(0, 60)}`;
}

export function criarFerramentas(deps: DependenciasFerramentas, ctx: ContextoPergunta) {
  const registrar = criarRegistroDeFontes(ctx);

  async function medir(nome: string, trabalho: () => Promise<string>): Promise<string> {
    const inicio = Date.now();
    try {
      const resultado = await trabalho();
      ctx.chamadas.push({ nome, duracaoMs: Date.now() - inicio });
      return resultado;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      ctx.chamadas.push({ nome, duracaoMs: Date.now() - inicio, erro: mensagem });
      // O erro volta ao modelo como texto: ele pode explicar a falha em vez de a pergunta quebrar.
      return `Erro ao executar ${nome}: o serviço consultado está indisponível no momento.`;
    }
  }

  const consultarBaseDeConhecimento = tool(
    ({ pergunta }) =>
      medir("consultar_base_conhecimento", async () => {
        const trechos = await recuperar(deps.pool, deps.embeddings, pergunta, {
          k: 5,
          oportunidadeId: ctx.oportunidadeId
        });
        if (trechos.length === 0) return "Nenhum trecho encontrado na base de conhecimento.";
        const ids = registrar(trechos.map(fonteDoTrecho), trechos.map(chaveDoTrecho));
        return formatarTrechos(trechos, ids);
      }),
    {
      name: "consultar_base_conhecimento",
      description:
        "Busca trechos relevantes na base de conhecimento do ConectaU: como a plataforma funciona (favoritos, " +
        "lembretes, avisos, curadoria, publicação, conta e privacidade), categorias e conceitos acadêmicos " +
        "(edital, monitoria, iniciação científica, horas complementares...) e o texto dos editais das " +
        "oportunidades publicadas (requisitos, documentos, carga horária, vagas). Use para explicar regras e " +
        "conteúdo. Não serve para listar quais oportunidades existem hoje: para isso use buscar_oportunidades.",
      schema: z.object({
        pergunta: z
          .string()
          .min(3)
          .describe("A dúvida reescrita como uma consulta completa e autocontida, em português.")
      })
    }
  );

  const buscarOportunidades = tool(
    ({ busca, campus, categoria, limite }) =>
      medir("buscar_oportunidades", async () => {
        const parametros = new URLSearchParams({ limite: String(limite ?? 5) });
        if (busca) parametros.set("busca", termosDeBusca(busca));
        if (campus) parametros.set("campus", campus);
        if (categoria) parametros.set("categoria", categoria);
        const { corpo } = await chamar<{ itens: OportunidadePublica[]; total: number }>(
          `${deps.oportunidadesUrl}/api/v1/oportunidades?${parametros}`,
          { timeoutMs: 4000, retentativas: 1, esperaInicialMs: 300, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }
        );
        if (corpo.itens.length === 0) {
          return "Nenhuma oportunidade publicada corresponde a esses filtros. Tente menos filtros ou outras palavras.";
        }
        const ids = registrar(
          corpo.itens.map((o) => ({
            tipo: "CATALOGO" as const,
            titulo: o.titulo,
            trecho: cortar(o.descricao ?? o.titulo, 400),
            fonteUrl: o.fonteUrl,
            oportunidadeId: o.id
          })),
          corpo.itens.map((o) => `CATALOGO|${o.id}`)
        );
        const linhas = corpo.itens.map((o, i) => formatarOportunidade(o, ids[i] ?? "F?", false));
        return `${corpo.itens.length} de ${corpo.total} oportunidade(s) publicada(s), ordenadas por relevância e prazo mais próximo. Hoje é ${dia(new Date().toISOString())}.\n\n${linhas.join("\n\n")}`;
      }),
    {
      name: "buscar_oportunidades",
      description:
        "Lista as oportunidades PUBLICADAS agora no ConectaU (dados reais e atuais), com prazo de inscrição e " +
        "link da fonte oficial. Use para perguntas como 'quais bolsas estão abertas?', 'o que tem no campus de " +
        "Lavras?', 'o que fecha primeiro?'. Todos os filtros são opcionais.",
      schema: z.object({
        busca: z
          .string()
          .optional()
          .describe("Palavras-chave curtas do tema (ex.: 'docker', 'pesquisa dados'). Não coloque campus nem categoria aqui."),
        campus: z.enum(CAMPI).optional().describe("Filtra por campus."),
        categoria: z.enum(CATEGORIAS).optional().describe("Filtra por categoria."),
        limite: z.number().int().min(1).max(8).optional().describe("Quantidade de resultados (padrão 5).")
      })
    }
  );

  const detalharOportunidade = tool(
    ({ oportunidadeId }) =>
      medir("detalhar_oportunidade", async () => {
        const { corpo } = await chamar<OportunidadePublica>(
          `${deps.oportunidadesUrl}/api/v1/oportunidades/${oportunidadeId}`,
          { timeoutMs: 4000, retentativas: 1, esperaInicialMs: 300, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) }
        );
        const [id] = registrar(
          [
            {
              tipo: "CATALOGO",
              titulo: corpo.titulo,
              trecho: cortar(corpo.descricao ?? corpo.titulo, 400),
              fonteUrl: corpo.fonteUrl,
              oportunidadeId: corpo.id
            }
          ],
          [`CATALOGO|${corpo.id}`]
        );
        return formatarOportunidade(corpo, id ?? "F?", true);
      }),
    {
      name: "detalhar_oportunidade",
      description:
        "Traz os detalhes completos de UMA oportunidade publicada, a partir do id obtido em buscar_oportunidades.",
      schema: z.object({
        oportunidadeId: z.string().uuid().describe("Identificador (id) da oportunidade.")
      })
    }
  );

  return [consultarBaseDeConhecimento, buscarOportunidades, detalharOportunidade];
}

export function fonteDoTrecho(t: Trecho): Omit<FonteConsultada, "id" | "citada"> {
  return {
    tipo: t.tipo,
    titulo: t.titulo,
    trecho: cortar(t.texto, 400),
    similaridade: t.similaridade,
    ...(t.fonteUrl ? { fonteUrl: t.fonteUrl } : {}),
    ...(t.tipo === "OPORTUNIDADE" ? { oportunidadeId: t.referencia } : { documento: t.referencia })
  };
}

function formatarOportunidade(o: OportunidadePublica, id: string, completa: boolean): string {
  const linhas = [
    `[${id}] ${o.titulo} — ${o.categoria}, campus ${o.campus}`,
    `Prazo de inscrição: ${descreverPrazo(o.prazoInscricao)}`,
    ...(o.dataInicio ? [`Início: ${dia(o.dataInicio)}`] : []),
    `Fonte oficial: ${o.fonteUrl}`,
    `id: ${o.id}`,
    ...(o.tags?.length ? [`Temas: ${o.tags.join(", ")}`] : []),
    ...(o.descricao ? [`Descrição: ${completa ? o.descricao : cortar(o.descricao, 280)}`] : [])
  ];
  return linhas.join("\n");
}
