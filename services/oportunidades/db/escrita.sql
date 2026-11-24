-- Modelo de ESCRITA do serviço Oportunidades (instância oportunidades-db).
-- Catálogo normalizado, estado da SAGA de publicação e outbox, todos no mesmo banco
-- para que mudança de status, avanço da SAGA e registro do evento caibam numa transação local.

CREATE TABLE oportunidades (
  id              UUID PRIMARY KEY,
  candidato_id    UUID NOT NULL,
  origem          TEXT NOT NULL CHECK (origem IN ('COLETA', 'MANUAL')),
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  categoria       TEXT NOT NULL CHECK (categoria IN ('EVENTO', 'ATIVIDADE', 'BOLSA', 'PROJETO', 'PROCESSO_SELETIVO')),
  campus          TEXT NOT NULL CHECK (campus IN ('LAVRAS', 'SAO_SEBASTIAO_DO_PARAISO')),
  data_inicio     TIMESTAMPTZ,
  prazo_inscricao TIMESTAMPTZ NOT NULL,
  fonte_url       TEXT NOT NULL,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'RASCUNHO'
                  CHECK (status IN ('RASCUNHO', 'PUBLICANDO', 'PUBLICADA', 'ENCERRADA')),
  versao          INTEGER NOT NULL DEFAULT 1,
  publicada_em    TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oportunidades_status ON oportunidades (status, criado_em DESC);

CREATE TABLE saga_publicacao (
  id              UUID PRIMARY KEY,
  oportunidade_id UUID NOT NULL REFERENCES oportunidades (id) ON DELETE CASCADE,
  estado          TEXT NOT NULL CHECK (estado IN
                  ('INICIADA', 'EM_ANDAMENTO', 'COMPENSANDO', 'COMPENSADA', 'CONCLUIDA', 'FALHA_COMPENSACAO')),
  erro            TEXT,
  iniciada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_em   TIMESTAMPTZ,
  -- Reserva do worker: evita que duas réplicas executem a mesma SAGA ao mesmo tempo.
  reservada_ate   TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
);

-- No máximo uma SAGA em andamento por oportunidade.
CREATE UNIQUE INDEX saga_ativa_por_oportunidade ON saga_publicacao (oportunidade_id)
  WHERE estado IN ('INICIADA', 'EM_ANDAMENTO', 'COMPENSANDO');

CREATE TABLE saga_passos (
  saga_id       UUID NOT NULL REFERENCES saga_publicacao (id) ON DELETE CASCADE,
  passo         TEXT NOT NULL CHECK (passo IN ('CONSUMIR_CANDIDATO', 'INDEXAR_ASSISTENTE', 'CONCLUIR_PUBLICACAO')),
  ordem         INTEGER NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN ('PENDENTE', 'OK', 'FALHA', 'COMPENSADO')),
  -- true quando o passo falhou por timeout: pode ter sido aplicado, então também é compensado.
  incerto       BOOLEAN NOT NULL DEFAULT false,
  detalhe       TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, passo)
);

-- Transactional Outbox: o evento é gravado na mesma transação da alteração de negócio.
CREATE TABLE outbox (
  id          UUID PRIMARY KEY,
  agregado_id UUID NOT NULL,
  tipo        TEXT NOT NULL,
  chave       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_em  TIMESTAMPTZ
);

CREATE INDEX outbox_pendentes ON outbox (criado_em) WHERE enviado_em IS NULL;
