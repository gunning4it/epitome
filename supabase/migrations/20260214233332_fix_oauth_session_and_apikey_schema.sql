-- Fix sessions table: add token_hash column (H-1 security fix) and make token nullable
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64) UNIQUE;
ALTER TABLE public.sessions ALTER COLUMN token DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash);

-- Fix api_keys table: add tier column for rate limiting
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free';
