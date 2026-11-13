CREATE TABLE IF NOT EXISTS links (
    id          BIGSERIAL PRIMARY KEY,
    slug        VARCHAR(10) NOT NULL UNIQUE,
    url         TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    expires_at  TIMESTAMP(3),
    max_clicks  INTEGER,
    click_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Listagem de links ordenada por criação
CREATE INDEX IF NOT EXISTS links_created_at_idx ON links (created_at);

-- Sem FK em link_id: o único escritor (flush de logs) só insere ids vindos de um
-- JOIN com links, e a checagem por linha encarece o INSERT em lote.
CREATE TABLE IF NOT EXISTS access_logs (
    id          BIGSERIAL PRIMARY KEY,
    link_id     BIGINT NOT NULL,
    accessed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    referer     TEXT,
    user_agent  TEXT,
    ip          VARCHAR(45)
);

-- Usado pelas queries de stats (diário e últimos acessos)
CREATE INDEX IF NOT EXISTS access_logs_link_id_accessed_at_idx ON access_logs (link_id, accessed_at);
