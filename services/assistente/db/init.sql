-- Esquema do banco do serviço Assistente (instância assistente-db, PostgreSQL + pgvector).

CREATE EXTENSION IF NOT EXISTS vector;

-- Trechos indexados (texto + embedding). Gravados pela SAGA de publicação.
CREATE TABLE chunks (
  id              UUID PRIMARY KEY,
  oportunidade_id UUID NOT NULL,
  saga_id         UUID,
  ordem           INTEGER NOT NULL,
  titulo          TEXT NOT NULL,
  texto           TEXT NOT NULL,
  fonte_url       TEXT,
  embedding       vector(256) NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chunks_por_oportunidade ON chunks (oportunidade_id);
CREATE INDEX chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE conversas (
  id              UUID PRIMARY KEY,
  usuario_id      UUID NOT NULL,
  oportunidade_id UUID,
  criada_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mensagens (
  id          UUID PRIMARY KEY,
  conversa_id UUID NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
  pergunta    TEXT NOT NULL,
  resposta    TEXT NOT NULL,
  citacoes    JSONB NOT NULL DEFAULT '[]',
  degradada   BOOLEAN NOT NULL DEFAULT false,
  criada_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache de respostas do LLM (usado a partir da Parte 4).
CREATE TABLE cache_respostas (
  chave     TEXT PRIMARY KEY,
  resposta  JSONB NOT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
