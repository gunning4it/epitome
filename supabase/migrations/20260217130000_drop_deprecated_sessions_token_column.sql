-- L-5 SECURITY FIX: Drop deprecated plaintext token column from sessions table.
-- Only the token_hash column is used (H-1 fix). The plaintext column was kept
-- nullable during migration; it is now safe to remove.
--
-- REVIEW REQUIRED: Verify no application code references sessions.token before running.

ALTER TABLE public.sessions DROP COLUMN IF EXISTS token;
