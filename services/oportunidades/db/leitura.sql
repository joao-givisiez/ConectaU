-- Modelo de LEITURA do serviço Oportunidades (instância oportunidades-leitura-db).
-- Desnormalizado, com busca textual em português. Escrito apenas pelo projetor do CQRS
-- e descartável: pode ser reconstruído a partir do modelo de escrita.

CREATE TABLE oportunidades_view (
  id              UUID PRIMARY KEY,
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  categoria       TEXT NOT NULL,
  campus          TEXT NOT NULL,
  data_inicio     TIMESTAMPTZ,
  prazo_inscricao TIMESTAMPTZ NOT NULL,
  fonte_url       TEXT NOT NULL,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  origem          TEXT,
  -- false depois do encerramento: a linha fica como marca, para descartar eventos atrasados.
  visivel         BOOLEAN NOT NULL,
  versao          INTEGER NOT NULL,
  publicada_em    TIMESTAMPTZ,
  busca           TSVECTOR NOT NULL,
  projetada_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oportunidades_view_busca ON oportunidades_view USING GIN (busca);
CREATE INDEX oportunidades_view_tags ON oportunidades_view USING GIN (tags);
CREATE INDEX oportunidades_view_filtros ON oportunidades_view (campus, categoria, prazo_inscricao) WHERE visivel;

-- Defasagem medida pelo projetor (tempo entre o evento e a gravação na leitura).
CREATE TABLE projetor_estado (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_evento       TEXT,
  ultima_defasagem_ms INTEGER,
  eventos_aplicados   BIGINT NOT NULL DEFAULT 0,
  atualizado_em       TIMESTAMPTZ
);

INSERT INTO projetor_estado (id) VALUES (1);
