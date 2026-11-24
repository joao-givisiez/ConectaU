import { randomUUID } from "node:crypto";
import {
  Corpo,
  Publicador,
  chamar,
  criarApp,
  criarPool,
  erros,
  exigirAdmin,
  finalizarApp,
  idDoCaminho,
  iniciar,
  listaDaQuery,
  paginacao,
  requestIdDe,
  textoDaQuery,
  transacao,
  usuarioOpcional,
  variavel,
  variavelNumero,
  verificarBanco
} from "@conectau/comum";
import {
  CAMPI,
  CATEGORIAS,
  COLUNAS,
  EVENTOS,
  STATUS,
  registrarEvento,
  representarEscrita,
  representarLeitura,
  type LinhaOportunidade,
  type LinhaVisao,
  type Status
} from "./modelo.js";
import { iniciarRelay } from "./relay.js";
import { Orquestrador } from "./saga.js";

const SERVICO = "oportunidades";
const PORTA = variavelNumero("PORT", 3103);
const COLETA_URL = variavel("COLETA_URL");
const TOKEN_SERVICO = variavel("TOKEN_SERVICO");

// CQRS: um pool para o modelo de escrita e outro, em outra instância, para o modelo de leitura.
const escrita = criarPool();
const leitura = criarPool("LEITURA_");
const publicador = new Publicador(variavel("RABBITMQ_URL"));

const orquestrador = new Orquestrador({
  pool: escrita,
  coletaUrl: COLETA_URL,
  assistenteUrl: variavel("ASSISTENTE_URL"),
  tokenServico: TOKEN_SERVICO,
  retentativas: variavelNumero("SAGA_RETENTATIVAS", 3),
  esperaInicialMs: variavelNumero("SAGA_ESPERA_INICIAL_MS", 1000),
  timeoutMs: variavelNumero("SAGA_TIMEOUT_MS", 10000)
});

const app = criarApp(SERVICO, async () => {
  await verificarBanco(escrita);
  await verificarBanco(leitura);
  const { rows } = await escrita.query<{ pendentes: string }>(
    "SELECT count(*) AS pendentes FROM outbox WHERE enviado_em IS NULL"
  );
  return {
    bancoEscrita: "ok",
    bancoLeitura: "ok",
    rabbitmq: publicador.conectado ? "conectado" : "desconectado",
    outboxPendentes: Number(rows[0]?.pendentes ?? 0)
  };
});

async function buscarEscrita(id: string): Promise<LinhaOportunidade | undefined> {
  const { rows } = await escrita.query<LinhaOportunidade>(`SELECT ${COLUNAS} FROM oportunidades WHERE id = $1`, [id]);
  return rows[0];
}

async function ultimaSaga(oportunidadeId: string): Promise<string | undefined> {
  const { rows } = await escrita.query<{ id: string }>(
    "SELECT id FROM saga_publicacao WHERE oportunidade_id = $1 ORDER BY iniciada_em DESC LIMIT 1",
    [oportunidadeId]
  );
  return rows[0]?.id;
}

function validarDatas(dataInicio: Date | null | undefined, prazo: Date): void {
  if (dataInicio && prazo.getTime() > dataInicio.getTime()) {
    throw erros.regraDeNegocio("O prazo de inscrição não pode ser posterior à data de início");
  }
}

// ---------- Consultas ----------

/**
 * Listagem. Sem `status`: modelo de LEITURA (só PUBLICADA), público.
 * Com `status`: modelo de ESCRITA, exclusivo de ADMIN (curadoria de rascunhos).
 */
app.get("/api/v1/oportunidades", async (req, res) => {
  const usuario = usuarioOpcional(req);
  const { pagina, limite, offset } = paginacao(req.query);
  const status = textoDaQuery(req.query.status);

  if (status !== undefined) {
    exigirAdmin(req);
    if (!(STATUS as readonly string[]).includes(status)) throw erros.requisicaoInvalida("status inválido");
    const [itens, total] = await Promise.all([
      escrita.query<LinhaOportunidade>(
        `SELECT ${COLUNAS} FROM oportunidades WHERE status = $1 ORDER BY criado_em DESC LIMIT $2 OFFSET $3`,
        [status, limite, offset]
      ),
      escrita.query<{ total: string }>("SELECT count(*) AS total FROM oportunidades WHERE status = $1", [status])
    ]);
    res.json({
      itens: itens.rows.map((o) => representarEscrita(o, usuario)),
      pagina,
      limite,
      total: Number(total.rows[0]?.total ?? 0)
    });
    return;
  }

  const condicoes = ["visivel"];
  const parametros: unknown[] = [];
  const busca = textoDaQuery(req.query.busca);
  const campus = textoDaQuery(req.query.campus);
  const categoria = textoDaQuery(req.query.categoria);
  const tags = listaDaQuery(req.query.tags);
  if (campus) {
    if (!(CAMPI as readonly string[]).includes(campus)) throw erros.requisicaoInvalida("campus inválido");
    parametros.push(campus);
    condicoes.push(`campus = $${parametros.length}`);
  }
  if (categoria) {
    if (!(CATEGORIAS as readonly string[]).includes(categoria)) throw erros.requisicaoInvalida("categoria inválida");
    parametros.push(categoria);
    condicoes.push(`categoria = $${parametros.length}`);
  }
  if (tags.length > 0) {
    parametros.push(tags);
    condicoes.push(`tags && $${parametros.length}::text[]`);
  }
  let ordem = "prazo_inscricao ASC";
  if (busca) {
    parametros.push(busca);
    const indice = parametros.length;
    condicoes.push(`busca @@ websearch_to_tsquery('portuguese', $${indice})`);
    ordem = `ts_rank(busca, websearch_to_tsquery('portuguese', $${indice})) DESC, prazo_inscricao ASC`;
  }
  const onde = condicoes.join(" AND ");
  const [itens, total] = await Promise.all([
    leitura.query<LinhaVisao>(
      `SELECT * FROM oportunidades_view WHERE ${onde} ORDER BY ${ordem}
        LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
      [...parametros, limite, offset]
    ),
    leitura.query<{ total: string }>(`SELECT count(*) AS total FROM oportunidades_view WHERE ${onde}`, parametros)
  ]);
  res.json({
    itens: itens.rows.map((o) => representarLeitura(o, usuario)),
    pagina,
    limite,
    total: Number(total.rows[0]?.total ?? 0)
  });
});

/** Detalhe. ADMIN vê o modelo de escrita (qualquer status); os demais, só o que está publicado. */
app.get("/api/v1/oportunidades/:oportunidadeId", async (req, res) => {
  const id = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const usuario = usuarioOpcional(req);
  if (usuario?.papel === "ADMIN") {
    const oportunidade = await buscarEscrita(id);
    if (!oportunidade) throw erros.naoEncontrado("Oportunidade não encontrada");
    res.json(representarEscrita(oportunidade, usuario, await ultimaSaga(id)));
    return;
  }
  const { rows } = await leitura.query<LinhaVisao>("SELECT * FROM oportunidades_view WHERE id = $1 AND visivel", [id]);
  const visao = rows[0];
  if (!visao) throw erros.naoEncontrado("Oportunidade não encontrada");
  res.json(representarLeitura(visao, usuario));
});

// ---------- Comandos (ADMIN) ----------

app.post("/api/v1/oportunidades", async (req, res) => {
  const usuario = exigirAdmin(req);
  const corpo = new Corpo(req.body);
  const candidatoId = corpo.uuid("candidatoId");
  const titulo = corpo.texto("titulo", 300);
  const descricao = corpo.textoOpcional("descricao", 20000);
  const categoria = corpo.enumeracao("categoria", CATEGORIAS);
  const campus = corpo.enumeracao("campus", CAMPI);
  const dataInicio = corpo.dataOpcional("dataInicio");
  const prazo = corpo.data("prazoInscricao");
  const fonteUrl = corpo.url("fonteUrl");
  const tags = corpo.listaTextos("tags") ?? [];
  validarDatas(dataInicio, prazo);

  // Toda oportunidade nasce de um candidato PENDENTE da Coleta.
  const { corpo: candidato } = await chamar<{ status: string; origem: string }>(
    `${COLETA_URL}/internal/candidatos/${candidatoId}`,
    { cabecalhos: { "X-Token-Servico": TOKEN_SERVICO }, requestId: requestIdDe(res), timeoutMs: 5000 }
  );
  if (candidato.status !== "PENDENTE") {
    throw erros.conflito(`O candidato está ${candidato.status}; só candidatos PENDENTES geram oportunidades`);
  }

  const id = randomUUID();
  const { rows } = await escrita.query<LinhaOportunidade>(
    `INSERT INTO oportunidades
       (id, candidato_id, origem, titulo, descricao, categoria, campus, data_inicio, prazo_inscricao, fonte_url, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLUNAS}`,
    [id, candidatoId, candidato.origem, titulo, descricao ?? null, categoria, campus, dataInicio ?? null, prazo, fonteUrl, tags]
  );
  res.status(201).location(`/api/v1/oportunidades/${id}`).json(representarEscrita(rows[0]!, usuario));
});

app.patch("/api/v1/oportunidades/:oportunidadeId", async (req, res) => {
  const usuario = exigirAdmin(req);
  const id = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const corpo = new Corpo(req.body);
  const mudancas = {
    titulo: corpo.textoOpcional("titulo", 300),
    descricao: corpo.textoOpcional("descricao", 20000),
    categoria: corpo.enumeracaoOpcional("categoria", CATEGORIAS),
    campus: corpo.enumeracaoOpcional("campus", CAMPI),
    dataInicio: corpo.dataOpcional("dataInicio"),
    prazo: corpo.dataOpcional("prazoInscricao"),
    fonteUrl: corpo.urlOpcional("fonteUrl"),
    tags: corpo.listaTextos("tags")
  };

  const atualizada = await transacao(escrita, async (cliente) => {
    const { rows } = await cliente.query<LinhaOportunidade>(
      `SELECT ${COLUNAS} FROM oportunidades WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const atual = rows[0];
    if (!atual) throw erros.naoEncontrado("Oportunidade não encontrada");
    if (atual.status !== "RASCUNHO" && atual.status !== "PUBLICADA") {
      throw erros.conflito(`Oportunidade em ${atual.status} não pode ser editada`);
    }
    validarDatas(mudancas.dataInicio ?? atual.data_inicio, mudancas.prazo ?? atual.prazo_inscricao);
    const resultado = await cliente.query<LinhaOportunidade>(
      `UPDATE oportunidades SET
          titulo = COALESCE($2, titulo), descricao = COALESCE($3, descricao),
          categoria = COALESCE($4, categoria), campus = COALESCE($5, campus),
          data_inicio = COALESCE($6, data_inicio), prazo_inscricao = COALESCE($7, prazo_inscricao),
          fonte_url = COALESCE($8, fonte_url), tags = COALESCE($9, tags),
          versao = versao + 1, atualizado_em = now()
        WHERE id = $1
        RETURNING ${COLUNAS}`,
      [
        id,
        mudancas.titulo ?? null,
        mudancas.descricao ?? null,
        mudancas.categoria ?? null,
        mudancas.campus ?? null,
        mudancas.dataInicio ?? null,
        mudancas.prazo ?? null,
        mudancas.fonteUrl ?? null,
        mudancas.tags ?? null
      ]
    );
    const nova = resultado.rows[0]!;
    // Só a edição de algo já publicado precisa chegar ao modelo de leitura e ao Engajamento.
    if (nova.status === "PUBLICADA") await registrarEvento(cliente, EVENTOS.editada, nova);
    return nova;
  });
  res.json(representarEscrita(atualizada, usuario, await ultimaSaga(id)));
});

app.delete("/api/v1/oportunidades/:oportunidadeId", async (req, res) => {
  exigirAdmin(req);
  const id = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const { rowCount } = await escrita.query("DELETE FROM oportunidades WHERE id = $1 AND status = 'RASCUNHO'", [id]);
  if (rowCount === 0) {
    const atual = await buscarEscrita(id);
    if (!atual) throw erros.naoEncontrado("Oportunidade não encontrada");
    throw erros.conflito("Só oportunidades em RASCUNHO podem ser excluídas; use o encerramento");
  }
  res.status(204).end();
});

app.post("/api/v1/oportunidades/:oportunidadeId/encerramento", async (req, res) => {
  const usuario = exigirAdmin(req);
  const id = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const encerrada = await transacao(escrita, async (cliente) => {
    const { rows } = await cliente.query<LinhaOportunidade>(
      `UPDATE oportunidades SET status = 'ENCERRADA', versao = versao + 1, atualizado_em = now()
        WHERE id = $1 AND status = 'PUBLICADA'
        RETURNING ${COLUNAS}`,
      [id]
    );
    const linha = rows[0];
    if (!linha) {
      const atual = (await cliente.query("SELECT status FROM oportunidades WHERE id = $1", [id])).rows[0];
      if (!atual) throw erros.naoEncontrado("Oportunidade não encontrada");
      throw erros.conflito("Só oportunidades PUBLICADAS podem ser encerradas");
    }
    await registrarEvento(cliente, EVENTOS.encerrada, linha);
    return linha;
  });
  res.json(representarEscrita(encerrada, usuario, await ultimaSaga(id)));
});

/** Dispara a SAGA: passo 1 (RASCUNHO → PUBLICANDO) é local e síncrono; o resto é assíncrono (202). */
app.post("/api/v1/oportunidades/:oportunidadeId/publicacao", async (req, res) => {
  exigirAdmin(req);
  const id = idDoCaminho(req.params.oportunidadeId, "Oportunidade");
  const sagaId = randomUUID();
  await transacao(escrita, async (cliente) => {
    const { rows } = await cliente.query<{ status: Status }>(
      "SELECT status FROM oportunidades WHERE id = $1 FOR UPDATE",
      [id]
    );
    const atual = rows[0];
    if (!atual) throw erros.naoEncontrado("Oportunidade não encontrada");
    if (atual.status !== "RASCUNHO") throw erros.conflito(`Só oportunidades em RASCUNHO podem ser publicadas (atual: ${atual.status})`);
    await cliente.query("UPDATE oportunidades SET status = 'PUBLICANDO', atualizado_em = now() WHERE id = $1", [id]);
    await cliente.query("INSERT INTO saga_publicacao (id, oportunidade_id, estado) VALUES ($1, $2, 'INICIADA')", [sagaId, id]);
    await cliente.query(
      `INSERT INTO saga_passos (saga_id, passo, ordem) VALUES
         ($1, 'CONSUMIR_CANDIDATO', 1), ($1, 'INDEXAR_ASSISTENTE', 2), ($1, 'CONCLUIR_PUBLICACAO', 3)`,
      [sagaId]
    );
  });
  orquestrador.acordar();
  res
    .status(202)
    .location(`/api/v1/publicacoes/${sagaId}`)
    .json({
      sagaId,
      estado: "INICIADA",
      _links: { estado: { href: `/api/v1/publicacoes/${sagaId}`, method: "GET" } }
    });
});

app.get("/api/v1/publicacoes/:sagaId", async (req, res) => {
  exigirAdmin(req);
  const sagaId = idDoCaminho(req.params.sagaId, "Publicação");
  const { rows } = await escrita.query<{
    id: string;
    oportunidade_id: string;
    estado: string;
    erro: string | null;
    iniciada_em: Date;
    finalizada_em: Date | null;
  }>("SELECT id, oportunidade_id, estado, erro, iniciada_em, finalizada_em FROM saga_publicacao WHERE id = $1", [sagaId]);
  const saga = rows[0];
  if (!saga) throw erros.naoEncontrado("Publicação não encontrada");
  const passos = await escrita.query<{ passo: string; estado: string; detalhe: string | null; atualizado_em: Date }>(
    "SELECT passo, estado, detalhe, atualizado_em FROM saga_passos WHERE saga_id = $1 ORDER BY ordem",
    [sagaId]
  );
  res.json({
    sagaId: saga.id,
    oportunidadeId: saga.oportunidade_id,
    estado: saga.estado,
    erro: saga.erro ?? undefined,
    passos: passos.rows.map((p) => ({
      passo: p.passo,
      estado: p.estado,
      detalhe: p.detalhe ?? undefined,
      atualizadoEm: p.atualizado_em.toISOString()
    })),
    iniciadaEm: saga.iniciada_em.toISOString(),
    finalizadaEm: saga.finalizada_em?.toISOString()
  });
});

finalizarApp(app, SERVICO);

const pararRelay = iniciarRelay(escrita, publicador);
orquestrador.iniciar();

iniciar(app, PORTA, SERVICO, async () => {
  pararRelay();
  orquestrador.parar();
  await publicador.fechar();
  await Promise.all([escrita.end(), leitura.end()]);
});
