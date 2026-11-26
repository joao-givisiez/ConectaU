-- Esquema do banco do serviço Assistente (instância assistente-db, PostgreSQL + pgvector).
-- Executado uma única vez, na criação do volume, pelo entrypoint oficial do PostgreSQL.
-- Os embeddings têm 384 posições (modelo multilingual-e5-small); trocar de modelo exige
-- recriar as colunas vector e reindexar.

CREATE EXTENSION IF NOT EXISTS vector;

-- Trechos dos editais: o texto de cada oportunidade publicada. Gravados pela SAGA de publicação.
CREATE TABLE chunks (
  id              UUID PRIMARY KEY,
  oportunidade_id UUID NOT NULL,
  saga_id         UUID,
  ordem           INTEGER NOT NULL,
  titulo          TEXT NOT NULL,
  texto           TEXT NOT NULL,
  fonte_url       TEXT,
  embedding       vector(384) NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chunks_por_oportunidade ON chunks (oportunidade_id);
CREATE INDEX chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- Base de conhecimento do domínio: documentos sobre o ConectaU e conceitos acadêmicos,
-- ingeridos dos arquivos em conhecimento/*.md na subida do serviço (idempotente, por hash).
CREATE TABLE base_conhecimento (
  id               UUID PRIMARY KEY,
  documento        TEXT NOT NULL,
  titulo_documento TEXT NOT NULL,
  secao            TEXT NOT NULL,
  ordem            INTEGER NOT NULL,
  texto            TEXT NOT NULL,
  hash_documento   TEXT NOT NULL,
  embedding        vector(384) NOT NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (documento, ordem)
);

CREATE INDEX base_conhecimento_embedding ON base_conhecimento USING hnsw (embedding vector_cosine_ops);

-- Estado do índice. `versao` sobe a cada mudança no conteúdo indexado e invalida o cache.
CREATE TABLE indice_estado (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO indice_estado (chave, valor) VALUES ('versao', '1');

CREATE TABLE conversas (
  id              UUID PRIMARY KEY,
  usuario_id      UUID NOT NULL,
  oportunidade_id UUID,
  criada_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mensagens (
  id                 UUID PRIMARY KEY,
  conversa_id        UUID NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
  pergunta           TEXT NOT NULL,
  resposta           TEXT NOT NULL,
  fontes             JSONB NOT NULL DEFAULT '[]',
  degradada          BOOLEAN NOT NULL DEFAULT false,
  motivo_degradacao  TEXT,
  -- Modo de execução: agente (padrão), rag (cadeia com recuperação), sem-recuperacao, recuperacao.
  modo               TEXT NOT NULL DEFAULT 'agente',
  -- Quem produziu a resposta: o modelo, o cache, o fallback de recuperação ou a guarda de escopo (recusa).
  origem             TEXT NOT NULL CHECK (origem IN ('LLM', 'CACHE', 'FALLBACK', 'RECUSA')),
  modelo             TEXT,
  -- Medições, usadas na análise de latência e custo (GET /internal/llm).
  latencia_ms        INTEGER NOT NULL DEFAULT 0,
  tokens_entrada     INTEGER NOT NULL DEFAULT 0,
  tokens_saida       INTEGER NOT NULL DEFAULT 0,
  custo_estimado_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
  ferramentas        JSONB NOT NULL DEFAULT '[]',
  criada_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mensagens_por_conversa ON mensagens (conversa_id, criada_em);
CREATE INDEX mensagens_por_data ON mensagens (criada_em);

-- Cache de respostas do LLM. Busca exata pela chave (pergunta normalizada + escopo + versão do
-- índice) e, se não achar, busca semântica pelo embedding da pergunta (cache semântico).
CREATE TABLE cache_respostas (
  chave         TEXT PRIMARY KEY,
  escopo        TEXT NOT NULL,
  versao_indice BIGINT NOT NULL,
  pergunta      TEXT NOT NULL,
  embedding     vector(384) NOT NULL,
  resposta      JSONB NOT NULL,
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em     TIMESTAMPTZ NOT NULL,
  acertos       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX cache_respostas_embedding ON cache_respostas USING hnsw (embedding vector_cosine_ops);
CREATE INDEX cache_respostas_expiracao ON cache_respostas (expira_em);
