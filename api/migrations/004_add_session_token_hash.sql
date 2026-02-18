/**
 * Migration: Add Session Token Hash Column (H-1 Security Fix)
 *
 * SECURITY: Session tokens are now hashed with SHA-256 before storage
 * to prevent account takeover if the database is breached.
 *
 * Steps:
 * 1. Add token_hash column
 * 2. Create index on token_hash
 * 3. Make token column nullable (for migration)
 * 4. Future: Remove token column after confirming all sessions migrated
 */

-- Step 1: Add token_hash column
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64) UNIQUE;

-- Step 2: Create index on token_hash (for active sessions only)
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON public.sessions (token_hash)
  WHERE expires_at > NOW();

-- Step 3: Make token column nullable (allows new sessions without raw token)
ALTER TABLE public.sessions
  ALTER COLUMN token DROP NOT NULL;

-- Step 4: Add comment explaining the migration
COMMENT ON COLUMN public.sessions.token_hash IS
  'SHA-256 hash of session token (H-1 Security Fix)';

COMMENT ON COLUMN public.sessions.token IS
  'DEPRECATED: Raw token (will be removed after migration to token_hash)';

-- Migration note: Existing sessions will continue to work with raw tokens
-- until they expire. New sessions use token_hash only.
