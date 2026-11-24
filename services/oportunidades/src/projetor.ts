import {
  Consumidor,
  criarApp,
  criarLog,
  criarPool,
  finalizarApp,
  iniciar,
  variavel,
  variavelNumero,
  verificarBanco,
  type Evento
} from "@conectau/comum";
import type { Retrato } from "./modelo.js";

/**
 * Projetor do CQRS: consome os eventos de Oportunidades e mantém o modelo de leitura.
 * Roda num container separado da API (mesma imagem, outro comando), porque escala
 * pela fila de eventos e não pela demanda HTTP.
 */

const SERVICO = "oportunidades-projetor";
const PORTA = variavelNumero("PORT", 3113);
const log = criarLog(SERVICO);
const leitura = criarPool("LEITURA_");

const consumidor = new Consumidor({
  url: variavel("RABBITMQ_URL"),
  servico: SERVICO,
  fila: "oportunidades.projetor",
  chaves: ["oportunidade.publicada", "oportunidade.editada", "oportunidade.encerrada"]
});

/**
 * Upsert idempotente: só aplica o evento se a versão for maior que a gravada.
 * Assim, eventos repetidos (at-least-once) ou fora de ordem não sobrescrevem dados novos.
 */
async function aplicar(evento: Evento): Promise<void> {
  const o = evento.payload as unknown as Retrato;
  const visivel = evento.tipo !== "OportunidadeEncerrada" && o.status === "PUBLICADA";
  const textoBusca = [o.titulo, o.descricao ?? "", o.tags.join(" "), o.categoria].join(" ");

  const { rowCount } = await leitura.query(
    `INSERT INTO oportunidades_view
       (id, titulo, descricao, categoria, campus, data_inicio, prazo_inscricao, fonte_url, tags, origem,
        visivel, versao, publicada_em, busca, projetada_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, to_tsvector('portuguese', $14), now())
     ON CONFLICT (id) DO UPDATE SET
       titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao, categoria = EXCLUDED.categoria,
       campus = EXCLUDED.campus, data_inicio = EXCLUDED.data_inicio, prazo_inscricao = EXCLUDED.prazo_inscricao,
       fonte_url = EXCLUDED.fonte_url, tags = EXCLUDED.tags, origem = EXCLUDED.origem, visivel = EXCLUDED.visivel,
       versao = EXCLUDED.versao, publicada_em = EXCLUDED.publicada_em, busca = EXCLUDED.busca, projetada_em = now()
     WHERE oportunidades_view.versao < EXCLUDED.versao`,
    [
      o.id,
      o.titulo,
      o.descricao,
      o.categoria,
      o.campus,
      o.dataInicio,
      o.prazoInscricao,
      o.fonteUrl,
      o.tags,
      o.origem,
      visivel,
      o.versao,
      o.publicadaEm,
      textoBusca
    ]
  );

  const defasagemMs = Date.now() - new Date(evento.ocorridoEm).getTime();
  await leitura.query(
    `UPDATE projetor_estado
        SET ultimo_evento = $1, ultima_defasagem_ms = $2, eventos_aplicados = eventos_aplicados + $3, atualizado_em = now()
      WHERE id = 1`,
    [evento.tipo, defasagemMs, rowCount ?? 0]
  );
  log.info(rowCount ? `${evento.tipo} aplicado ao modelo de leitura` : `${evento.tipo} ignorado (versão antiga ou repetida)`, {
    oportunidadeId: o.id,
    versao: o.versao,
    defasagemMs
  });
}

const app = criarApp(SERVICO, async () => {
  await verificarBanco(leitura);
  const { rows } = await leitura.query<{ ultima_defasagem_ms: number | null; eventos_aplicados: string }>(
    "SELECT ultima_defasagem_ms, eventos_aplicados FROM projetor_estado WHERE id = 1"
  );
  return {
    bancoLeitura: "ok",
    rabbitmq: consumidor.conectado ? "conectado" : "desconectado",
    ultimaDefasagemMs: rows[0]?.ultima_defasagem_ms ?? null,
    eventosAplicados: Number(rows[0]?.eventos_aplicados ?? 0)
  };
});
finalizarApp(app, SERVICO);

consumidor.iniciar(aplicar);
iniciar(app, PORTA, SERVICO, async () => {
  await consumidor.fechar();
  await leitura.end();
});
