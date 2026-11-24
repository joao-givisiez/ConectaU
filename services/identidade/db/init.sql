-- Esquema do banco do serviço Identidade (instância identidade-db).
-- Executado uma única vez, na criação do volume, pelo entrypoint oficial do PostgreSQL.

CREATE TABLE usuarios (
  id            UUID PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  curso         TEXT NOT NULL,
  campus        TEXT NOT NULL CHECK (campus IN ('LAVRAS', 'SAO_SEBASTIAO_DO_PARAISO')),
  papel         TEXT NOT NULL DEFAULT 'ESTUDANTE' CHECK (papel IN ('ESTUDANTE', 'ADMIN')),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interesses (
  usuario_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  interesse  TEXT NOT NULL,
  PRIMARY KEY (usuario_id, interesse)
);
