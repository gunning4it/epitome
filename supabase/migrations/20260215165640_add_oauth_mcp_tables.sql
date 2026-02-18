-- OAuth MCP tables for Claude Desktop / ChatGPT remote connector support
-- Dynamic client registration (RFC 7591) and authorization code flow (RFC 6749 + PKCE)

CREATE TABLE IF NOT EXISTS public.oauth_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       VARCHAR(200) NOT NULL UNIQUE,
  client_secret   VARCHAR(200),
  client_name     VARCHAR(200),
  redirect_uris   JSONB NOT NULL DEFAULT '[]',
  grant_types     JSONB NOT NULL DEFAULT '["authorization_code"]',
  response_types  JSONB NOT NULL DEFAULT '["code"]',
  token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'none',
  scope           VARCHAR(1000),
  client_uri      VARCHAR(2048),
  logo_uri        VARCHAR(2048),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(128) NOT NULL UNIQUE,
  client_id             VARCHAR(200) NOT NULL,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  redirect_uri          VARCHAR(2048) NOT NULL,
  scope                 VARCHAR(1000),
  code_challenge        VARCHAR(128) NOT NULL,
  code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',
  state                 VARCHAR(500),
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_clients_client_id ON public.oauth_clients(client_id);
CREATE INDEX idx_oauth_auth_codes_code ON public.oauth_authorization_codes(code);
CREATE INDEX idx_oauth_auth_codes_user ON public.oauth_authorization_codes(user_id);
