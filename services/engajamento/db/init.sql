-- Esquema do banco do serviço Engajamento (instância engajamento-db).

-- Cópia local (derivada de eventos) do mínimo que o Engajamento precisa saber de uma oportunidade.
CREATE TABLE oportunidade_resumo (
  id              UUID PRIMARY KEY,
  titulo          TEXT NOT NULL,
  prazo_inscricao TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL,
  versao          INTEGER NOT NULL,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE favoritos (
  id              UUID PRIMARY KEY,
  usuario_id      UUID NOT NULL,
  oportunidade_id UUID NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, oportunidade_id)
);

CREATE INDEX favoritos_por_oportunidade ON favoritos (oportunidade_id);

CREATE TABLE lembretes (
  id                 UUID PRIMARY KEY,
  usuario_id         UUID NOT NULL,
  oportunidade_id    UUID NOT NULL,
  antecedencia_horas INTEGER NOT NULL CHECK (antecedencia_horas BETWEEN 1 AND 720),
  disparar_em        TIMESTAMPTZ NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'AGENDADO' CHECK (estado IN ('AGENDADO', 'DISPARADO', 'CANCELADO')),
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, oportunidade_id)
);

CREATE INDEX lembretes_agendados ON lembretes (disparar_em) WHERE estado = 'AGENDADO';

CREATE TABLE notificacoes (
  id              UUID PRIMARY KEY,
  usuario_id      UUID NOT NULL,
  oportunidade_id UUID,
  tipo            TEXT NOT NULL CHECK (tipo IN ('PRAZO_PROXIMO', 'OPORTUNIDADE_ALTERADA', 'OPORTUNIDADE_ENCERRADA')),
  titulo          TEXT NOT NULL,
  mensagem        TEXT NOT NULL,
  lida            BOOLEAN NOT NULL DEFAULT false,
  criada_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notificacoes_por_usuario ON notificacoes (usuario_id, criada_em DESC);

-- Consumidor idempotente: cada messageId é processado uma única vez.
CREATE TABLE mensagens_processadas (
  message_id    UUID PRIMARY KEY,
  processada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
