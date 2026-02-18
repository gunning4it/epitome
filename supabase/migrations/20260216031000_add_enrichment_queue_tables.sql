-- Durable async enrichment queue for vectors/entity extraction

CREATE TABLE IF NOT EXISTS public.enrichment_jobs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type   VARCHAR(20) NOT NULL CHECK (source_type IN ('profile', 'table', 'vector')),
  source_ref    VARCHAR(255) NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'retry', 'done', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_sched
  ON public.enrichment_jobs(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_user
  ON public.enrichment_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_source
  ON public.enrichment_jobs(user_id, source_type, source_ref);

CREATE TABLE IF NOT EXISTS public.pending_vectors (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  collection    VARCHAR(100) NOT NULL,
  text          TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by    VARCHAR(100),
  origin        VARCHAR(20),
  source_ref    VARCHAR(255),
  vector_id     INTEGER,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'retry', 'done', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_vectors_sched
  ON public.pending_vectors(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_vectors_user
  ON public.pending_vectors(user_id, created_at DESC);
