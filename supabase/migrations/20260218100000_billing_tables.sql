-- Billing, Metering & Payment Tables
-- subscriptions: Stripe subscription state (one per user)
-- stripe_events: Webhook idempotency dedup
-- usage_records: Daily usage snapshots for dashboard
-- billing_transactions: Unified payment records (Stripe + x402)

-- 1. subscriptions
CREATE TABLE public.subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id       VARCHAR(255) NOT NULL,
  stripe_subscription_id   VARCHAR(255) UNIQUE,
  stripe_price_id          VARCHAR(255),
  status                   VARCHAR(30) NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete','incomplete_expired','trialing',
                       'active','past_due','canceled','unpaid','paused')),
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  canceled_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_cust ON public.subscriptions(stripe_customer_id);

-- 2. stripe_events
CREATE TABLE public.stripe_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stripe_events_processed ON public.stripe_events(processed_at);

-- 3. usage_records
CREATE TABLE public.usage_records (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  resource    VARCHAR(50) NOT NULL
    CHECK (resource IN ('tables','agents','graph_entities','api_calls','mcp_calls')),
  count       INTEGER NOT NULL DEFAULT 0,
  period_date DATE NOT NULL DEFAULT CURRENT_DATE,
  agent_id    VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_usage_unique
  ON public.usage_records(user_id, resource, period_date, COALESCE(agent_id, '__aggregate__'));
CREATE INDEX idx_usage_user_date ON public.usage_records(user_id, period_date DESC);

-- 4. billing_transactions
CREATE TABLE public.billing_transactions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payment_type               VARCHAR(20) NOT NULL CHECK (payment_type IN ('stripe','x402')),
  stripe_invoice_id          VARCHAR(255),
  stripe_payment_intent_id   VARCHAR(255),
  x402_tx_hash               VARCHAR(100),
  x402_network               VARCHAR(50),
  amount_micros              BIGINT NOT NULL,
  currency                   VARCHAR(10) NOT NULL DEFAULT 'usd',
  asset                      VARCHAR(20),
  status                     VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','refunded')),
  description                VARCHAR(500),
  metadata                   JSONB NOT NULL DEFAULT '{}',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_billing_tx_user ON public.billing_transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_billing_tx_stripe_invoice
  ON public.billing_transactions(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
-- Non-unique: a single payment intent may have multiple lifecycle events (pending → succeeded)
CREATE INDEX idx_billing_tx_stripe_pi
  ON public.billing_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Enable RLS on all new tables (follows pattern from 20260217110000)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;

-- Revoke anon/authenticated grants (follows pattern from 20260217120000)
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
REVOKE ALL ON public.stripe_events FROM anon, authenticated;
REVOKE ALL ON public.usage_records FROM anon, authenticated;
REVOKE ALL ON public.billing_transactions FROM anon, authenticated;
