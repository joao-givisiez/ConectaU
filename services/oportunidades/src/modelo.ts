import { randomUUID } from "node:crypto";
import type { ClienteBanco, Usuario } from "@conectau/comum";

export const CATEGORIAS = ["EVENTO", "ATIVIDADE", "BOLSA", "PROJETO", "PROCESSO_SELETIVO"] as const;
export const CAMPI = ["LAVRAS", "SAO_SEBASTIAO_DO_PARAISO"] as const;
export const STATUS = ["RASCUNHO", "PUBLICANDO", "PUBLICADA", "ENCERRADA"] as const;
export type Status = (typeof STATUS)[number];

/** Linha do modelo de escrita. */
export interface LinhaOportunidade {
  id: string;
  candidato_id: string;
  origem: string;
  titulo: string;
  descricao: string | null;
  categoria: string;
  campus: string;
  data_inicio: Date | null;
  prazo_inscricao: Date;
  fonte_url: string;
  tags: string[];
  status: Status;
  versao: number;
  publicada_em: Date | null;
}

/** Linha do modelo de leitura (só oportunidades publicadas). */
export interface LinhaVisao {
  id: string;
  titulo: string;
  descricao: string | null;
  categoria: string;
  campus: string;
  data_inicio: Date | null;
  prazo_inscricao: Date;
  fonte_url: string;
  tags: string[];
  origem: string | null;
  versao: number;
  publicada_em: Date | null;
}

const BASE = "/api/v1";

interface Link {
  href: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
}

/**
 * HATEOAS: os links dependem do estado da oportunidade e do papel de quem consulta.
 * Os BFFs reescrevem os caminhos para as rotas que os seus clientes usam.
 */
export function linksDe(id: string, status: Status, prazo: Date, fonteUrl: string, usuario?: Usuario) {
  const links: Record<string, Link> = {
    self: { href: `${BASE}/oportunidades/${id}`, method: "GET" },
    colecao: { href: `${BASE}/oportunidades`, method: "GET" },
    fonteOficial: { href: fonteUrl, method: "GET" }
  };
  const prazoAberto = prazo.getTime() > Date.now();
  if (usuario && status === "PUBLICADA") {
    if (prazoAberto) {
      links.salvar = { href: `${BASE}/favoritos`, method: "POST" };
      links.lembrar = { href: `${BASE}/lembretes`, method: "POST" };
    }
    links.perguntar = { href: `${BASE}/conversas`, method: "POST" };
  }
  if (usuario?.papel === "ADMIN") {
    if (status === "RASCUNHO") {
      links.editar = { href: `${BASE}/oportunidades/${id}`, method: "PATCH" };
      links.excluir = { href: `${BASE}/oportunidades/${id}`, method: "DELETE" };
      links.publicar = { href: `${BASE}/oportunidades/${id}/publicacao`, method: "POST" };
    }
    if (status === "PUBLICADA") {
      links.editar = { href: `${BASE}/oportunidades/${id}`, method: "PATCH" };
      links.encerrar = { href: `${BASE}/oportunidades/${id}/encerramento`, method: "POST" };
    }
  }
  return links;
}

/** Representação para o contrato administrativo (modelo de escrita, qualquer status). */
export function representarEscrita(o: LinhaOportunidade, usuario?: Usuario, sagaId?: string) {
  return {
    id: o.id,
    titulo: o.titulo,
    descricao: o.descricao ?? undefined,
    categoria: o.categoria,
    campus: o.campus,
    dataInicio: o.data_inicio?.toISOString(),
    prazoInscricao: o.prazo_inscricao.toISOString(),
    fonteUrl: o.fonte_url,
    tags: o.tags,
    status: o.status,
    origem: o.origem,
    candidatoId: o.candidato_id,
    versao: o.versao,
    publicadaEm: o.publicada_em?.toISOString(),
    sagaId,
    _links: linksDe(o.id, o.status, o.prazo_inscricao, o.fonte_url, usuario)
  };
}

/** Representação pública (modelo de leitura). */
export function representarLeitura(o: LinhaVisao, usuario?: Usuario) {
  return {
    id: o.id,
    titulo: o.titulo,
    descricao: o.descricao ?? undefined,
    categoria: o.categoria,
    campus: o.campus,
    dataInicio: o.data_inicio?.toISOString(),
    prazoInscricao: o.prazo_inscricao.toISOString(),
    fonteUrl: o.fonte_url,
    tags: o.tags,
    status: "PUBLICADA" as const,
    origem: o.origem ?? undefined,
    _links: linksDe(o.id, "PUBLICADA", o.prazo_inscricao, o.fonte_url, usuario)
  };
}

/** Conteúdo dos eventos: um retrato completo da oportunidade, com versão para ordenar. */
export function retrato(o: LinhaOportunidade) {
  return {
    id: o.id,
    titulo: o.titulo,
    descricao: o.descricao,
    categoria: o.categoria,
    campus: o.campus,
    dataInicio: o.data_inicio?.toISOString() ?? null,
    prazoInscricao: o.prazo_inscricao.toISOString(),
    fonteUrl: o.fonte_url,
    tags: o.tags,
    origem: o.origem,
    status: o.status,
    versao: o.versao,
    publicadaEm: o.publicada_em?.toISOString() ?? null
  };
}

export type Retrato = ReturnType<typeof retrato>;

export const EVENTOS = {
  publicada: { tipo: "OportunidadePublicada", chave: "oportunidade.publicada" },
  editada: { tipo: "OportunidadeEditada", chave: "oportunidade.editada" },
  encerrada: { tipo: "OportunidadeEncerrada", chave: "oportunidade.encerrada" }
} as const;

/** Grava o evento na outbox, dentro da transação recebida (nunca fora dela). */
export async function registrarEvento(
  cliente: ClienteBanco,
  evento: (typeof EVENTOS)[keyof typeof EVENTOS],
  oportunidade: LinhaOportunidade
): Promise<void> {
  await cliente.query("INSERT INTO outbox (id, agregado_id, tipo, chave, payload) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    oportunidade.id,
    evento.tipo,
    evento.chave,
    JSON.stringify(retrato(oportunidade))
  ]);
}

export const COLUNAS = `id, candidato_id, origem, titulo, descricao, categoria, campus, data_inicio,
  prazo_inscricao, fonte_url, tags, status, versao, publicada_em`;
