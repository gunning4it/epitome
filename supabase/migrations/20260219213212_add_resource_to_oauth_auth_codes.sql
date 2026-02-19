-- Add resource column (RFC 8707) to oauth_authorization_codes
ALTER TABLE public.oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS resource VARCHAR(2048);
