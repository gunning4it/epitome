/**
 * Epitome Database Schema Definitions
 * Drizzle ORM 0.39.x Schema for PostgreSQL 17.7
 *
 * This file defines the TypeScript schema for both:
 * - Public schema (multi-tenant system tables)
 * - User schema template (per-user isolated tables)
 *
 * NOTE: Dynamic user tables are created at runtime and not defined here.
 */

import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  integer,
  jsonb,
  text,
  serial,
  bigserial,
  bigint,
  real,
  check,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// JSONB Type Definitions for structured fields
export interface ChangedFields {
  [fieldPath: string]: { old: unknown; new: unknown };
}

export interface Contradiction {
  memory_id: string;
  reason: string;
  confidence_gap: number;
  detected_at: string;
}

export interface PromoteHistoryEntry {
  from_status: string;
  to_status: string;
  changed_at: string;
  reason?: string;
}

export interface Evidence {
  type: string;
  source: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable?: boolean;
}

// =====================================================
// PUBLIC SCHEMA: MULTI-TENANT SYSTEM TABLES
// =====================================================

/**
 * Master user account table
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    name: varchar('name', { length: 200 }),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    schemaName: varchar('schema_name', { length: 100 }).notNull().unique(),
    tier: varchar('tier', { length: 20 })
      .notNull()
      .default('free')
      .$type<'free' | 'pro' | 'enterprise'>(),
    onboarded: boolean('onboarded').notNull().default(false),
    embeddingProvider: varchar('embedding_provider', { length: 50 })
      .notNull()
      .default('openai')
      .$type<'openai' | 'nomic' | 'custom'>(),
    embeddingDim: integer('embedding_dim')
      .notNull()
      .default(1536)
      .$type<256 | 512 | 768 | 1024 | 1536>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    tierIdx: index('idx_users_tier').on(table.tier),
    tierCheck: check('tier_check', sql`${table.tier} IN ('free', 'pro', 'enterprise')`),
    providerCheck: check('provider_check', sql`${table.embeddingProvider} IN ('openai', 'nomic', 'custom')`),
    dimCheck: check('dim_check', sql`${table.embeddingDim} IN (256, 512, 768, 1024, 1536)`),
  })
);

/**
 * Bearer tokens for API authentication
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    keyHash: varchar('key_hash', { length: 128 }).notNull().unique(),
    prefix: varchar('prefix', { length: 12 }).notNull(),
    label: varchar('label', { length: 200 }),
    agentId: varchar('agent_id', { length: 100 }),
    tier: varchar('tier', { length: 20 }).notNull().default('free'), // Rate limit tier: free, pro, enterprise
    scopes: jsonb('scopes').notNull().default(['read', 'write']),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_api_keys_user').on(table.userId),
    prefixIdx: index('idx_api_keys_prefix').on(table.prefix),
  })
);

/**
 * Dashboard login sessions
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).unique(), // H-1 Security Fix: SHA-256 hash
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW() + INTERVAL '30 days'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: index('idx_sessions_token_hash') // H-1 Security Fix
      .on(table.tokenHash),
    userIdx: index('idx_sessions_user').on(table.userId),
  })
);

/**
 * OAuth provider connections
 */
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull().$type<'google' | 'github'>(),
    providerUserId: varchar('provider_user_id', { length: 200 }).notNull(),
    accessToken: varchar('access_token', { length: 2048 }),
    refreshToken: varchar('refresh_token', { length: 2048 }),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    rawProfile: jsonb('raw_profile'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_oauth_user').on(table.userId),
    providerUnique: unique('oauth_provider_unique').on(table.provider, table.providerUserId),
    providerCheck: check('provider_check', sql`${table.provider} IN ('google', 'github')`),
  })
);

/**
 * OAuth dynamic client registrations (RFC 7591)
 * Used by Claude Desktop / ChatGPT remote MCP connector
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: varchar('client_id', { length: 200 }).notNull().unique(),
    clientSecret: varchar('client_secret', { length: 200 }),
    clientName: varchar('client_name', { length: 200 }),
    redirectUris: jsonb('redirect_uris').notNull().default([]),
    grantTypes: jsonb('grant_types').notNull().default(['authorization_code']),
    responseTypes: jsonb('response_types').notNull().default(['code']),
    tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 50 }).notNull().default('none'),
    scope: varchar('scope', { length: 1000 }),
    clientUri: varchar('client_uri', { length: 2048 }),
    logoUri: varchar('logo_uri', { length: 2048 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdIdx: index('idx_oauth_clients_client_id').on(table.clientId),
  })
);

/**
 * OAuth authorization codes (RFC 6749 + PKCE)
 */
export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 128 }).notNull().unique(),
    clientId: varchar('client_id', { length: 200 }).notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    redirectUri: varchar('redirect_uri', { length: 2048 }).notNull(),
    scope: varchar('scope', { length: 1000 }),
    codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
    codeChallengeMethod: varchar('code_challenge_method', { length: 10 }).notNull().default('S256'),
    state: varchar('state', { length: 500 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeIdx: index('idx_oauth_auth_codes_code').on(table.code),
    userIdx: index('idx_oauth_auth_codes_user').on(table.userId),
  })
);

/**
 * Registered AI agent metadata
 */
export const agentRegistry = pgTable(
  'agent_registry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    agentId: varchar('agent_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    platform: varchar('platform', { length: 50 }),
    mcpUrl: varchar('mcp_url', { length: 2048 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    totalReads: integer('total_reads').notNull().default(0),
    totalWrites: integer('total_writes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_agent_registry_user').on(table.userId),
    agentUnique: unique('agent_unique').on(table.userId, table.agentId),
  })
);

/**
 * System-wide configuration
 */
export const systemConfig = pgTable('system_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// =====================================================
// USER SCHEMA TEMPLATE
// =====================================================
// These tables are created inside each user's isolated schema
// The actual table creation happens via the create_user_schema() function

/**
 * Versioned user profile (JSONB document)
 * Lives in user schema
 */
export const profileTemplate = {
  id: serial('id').primaryKey(),
  data: jsonb('data').notNull(),
  version: integer('version').notNull().default(1),
  changedBy: varchar('changed_by', { length: 100 }),
  changedFields: jsonb('changed_fields'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  metaId: integer('_meta_id'), // FK to memory_meta
};

/**
 * Memory quality metadata
 * Lives in user schema
 */
export const memoryMetaTemplate = {
  id: serial('id').primaryKey(),
  sourceType: varchar('source_type', { length: 20 })
    .notNull()
    .$type<'table' | 'vector' | 'profile' | 'entity' | 'edge'>(),
  sourceRef: varchar('source_ref', { length: 200 }).notNull(),
  origin: varchar('origin', { length: 20 })
    .notNull()
    .$type<'user_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system'>(),
  agentSource: varchar('agent_source', { length: 100 }),
  confidence: real('confidence').notNull().default(0.5),
  status: varchar('status', { length: 20 })
    .notNull()
    .default('active')
    .$type<'unvetted' | 'active' | 'trusted' | 'review' | 'decayed' | 'rejected'>(),
  accessCount: integer('access_count').notNull().default(0),
  lastAccessed: timestamp('last_accessed', { withTimezone: true }),
  lastReinforced: timestamp('last_reinforced', { withTimezone: true }),
  contradictions: jsonb('contradictions').notNull().default([]),
  promoteHistory: jsonb('promote_history').notNull().default([]),
  claimId: integer('claim_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Vector embeddings (semantic memory)
 * Lives in user schema
 * NOTE: The vector dimension is set at schema creation time
 */
export const vectorsTemplate = {
  id: serial('id').primaryKey(),
  collection: varchar('collection', { length: 100 }).notNull(),
  text: text('text').notNull(),
  // embedding: vector('embedding', { dimensions: 1536 }), // Set dynamically
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('_deleted_at', { withTimezone: true }),
  metaId: integer('_meta_id'), // FK to memory_meta
};

/**
 * Knowledge graph entities
 * Lives in user schema
 */
export const entitiesTemplate = {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  properties: jsonb('properties').notNull().default({}),
  confidence: real('confidence').notNull().default(0.5),
  mentionCount: integer('mention_count').notNull().default(1),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('_deleted_at', { withTimezone: true }),
};

/**
 * Knowledge graph edges (relationships)
 * Lives in user schema
 */
export const edgesTemplate = {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').notNull(), // FK to entities
  targetId: integer('target_id').notNull(), // FK to entities
  relation: varchar('relation', { length: 100 }).notNull(),
  weight: real('weight').notNull().default(1.0),
  confidence: real('confidence').notNull().default(0.5),
  evidence: jsonb('evidence').notNull().default([]),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  properties: jsonb('properties').notNull().default({}),
};

/**
 * Durable knowledge claims ledger
 * Lives in user schema
 */
export const knowledgeClaimsTemplate = {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  claimType: varchar('claim_type', { length: 50 }).notNull(),
  subject: jsonb('subject').notNull().default({}),
  predicate: varchar('predicate', { length: 200 }).notNull(),
  object: jsonb('object').notNull().default({}),
  confidence: real('confidence').notNull().default(0.5),
  status: varchar('status', { length: 20 }).notNull().default('proposed'),
  method: varchar('method', { length: 50 }).notNull().default('unknown'),
  origin: varchar('origin', { length: 20 }),
  sourceRef: varchar('source_ref', { length: 200 }),
  writeId: varchar('write_id', { length: 100 }),
  agentId: varchar('agent_id', { length: 100 }),
  model: varchar('model', { length: 200 }),
  memoryMetaId: integer('memory_meta_id'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validTo: timestamp('valid_to', { withTimezone: true }),
  supersededBy: bigint('superseded_by', { mode: 'number' }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Knowledge claim lifecycle events
 * Lives in user schema
 */
export const knowledgeClaimEventsTemplate = {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  claimId: bigint('claim_id', { mode: 'number' }).notNull(),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  fromStatus: varchar('from_status', { length: 20 }),
  toStatus: varchar('to_status', { length: 20 }),
  actorType: varchar('actor_type', { length: 20 }).notNull().default('system'),
  actorId: varchar('actor_id', { length: 100 }),
  reason: text('reason'),
  oldConfidence: real('old_confidence'),
  newConfidence: real('new_confidence'),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Knowledge claim evidence rows
 * Lives in user schema
 */
export const knowledgeClaimEvidenceTemplate = {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  claimId: bigint('claim_id', { mode: 'number' }).notNull(),
  evidenceType: varchar('evidence_type', { length: 40 }).notNull(),
  sourceRef: varchar('source_ref', { length: 200 }),
  tableName: varchar('table_name', { length: 100 }),
  recordId: bigint('record_id', { mode: 'number' }),
  vectorId: bigint('vector_id', { mode: 'number' }),
  profileVersion: integer('profile_version'),
  confidence: real('confidence'),
  extractionArtifact: jsonb('extraction_artifact').notNull().default({}),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Feedback loop for served context packs
 * Lives in user schema
 */
export const contextFeedbackTemplate = {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  contextKey: varchar('context_key', { length: 200 }).notNull(),
  intent: varchar('intent', { length: 200 }),
  tokenBudget: integer('token_budget'),
  timeHorizon: varchar('time_horizon', { length: 50 }),
  strictness: varchar('strictness', { length: 20 }),
  resources: jsonb('resources').notNull().default({}),
  servedClaimIds: jsonb('served_claim_ids').notNull().default([]),
  feedback: varchar('feedback', { length: 20 }).notNull(),
  correction: jsonb('correction').notNull().default({}),
  agentId: varchar('agent_id', { length: 100 }),
  model: varchar('model', { length: 200 }),
  sourceRef: varchar('source_ref', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Audit log (partitioned by month)
 * Lives in user schema
 */
export const auditLogTemplate = {
  id: bigserial('id', { mode: 'bigint' }),
  agentId: varchar('agent_id', { length: 100 }).notNull(),
  agentName: varchar('agent_name', { length: 100 }),
  action: varchar('action', { length: 20 })
    .notNull()
    .$type<'read' | 'write' | 'update' | 'delete' | 'search' | 'graph_query' | 'profile_read' | 'profile_write' | 'consent_check'>(),
  resource: varchar('resource', { length: 200 }).notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Per-agent consent rules
 * Lives in user schema
 */
export const consentRulesTemplate = {
  id: serial('id').primaryKey(),
  agentId: varchar('agent_id', { length: 100 }).notNull(),
  resource: varchar('resource', { length: 200 }).notNull(),
  permission: varchar('permission', { length: 10 })
    .notNull()
    .$type<'read' | 'write' | 'none'>(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
};

/**
 * Dynamic table metadata registry
 * Lives in user schema
 */
export const tableRegistryTemplate = {
  tableName: varchar('table_name', { length: 100 }).primaryKey(),
  description: text('description'),
  columns: jsonb('columns').notNull(),
  recordCount: integer('record_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Vector collection metadata registry
 * Lives in user schema
 */
export const vectorCollectionsTemplate = {
  collection: varchar('collection', { length: 100 }).primaryKey(),
  description: text('description'),
  entryCount: integer('entry_count').notNull().default(0),
  embeddingDim: integer('embedding_dim').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// =====================================================
// TYPE EXPORTS
// =====================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type NewOAuthConnection = typeof oauthConnections.$inferInsert;

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;

export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;

export type AgentRegistry = typeof agentRegistry.$inferSelect;
export type NewAgentRegistry = typeof agentRegistry.$inferInsert;

export type SystemConfig = typeof systemConfig.$inferSelect;
export type NewSystemConfig = typeof systemConfig.$inferInsert;

// User schema types (templates for documentation)
export type Profile = {
  id: number;
  data: Record<string, unknown>;
  version: number;
  changedBy?: string | null;
  changedFields?: ChangedFields;
  changedAt: Date;
  metaId?: number | null;
};

export type MemoryMeta = {
  id: number;
  sourceType: 'table' | 'vector' | 'profile' | 'entity' | 'edge';
  sourceRef: string;
  origin: 'user_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system';
  agentSource?: string | null;
  confidence: number;
  status: 'unvetted' | 'active' | 'trusted' | 'review' | 'decayed' | 'rejected';
  accessCount: number;
  lastAccessed?: Date | null;
  lastReinforced?: Date | null;
  contradictions: Contradiction[];
  promoteHistory: PromoteHistoryEntry[];
  createdAt: Date;
};

export type Vector = {
  id: number;
  collection: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  deletedAt?: Date | null;
  metaId?: number | null;
};

export type Entity = {
  id: number;
  type: string;
  name: string;
  properties: Record<string, any>;
  confidence: number;
  mentionCount: number;
  firstSeen: Date;
  lastSeen: Date;
  deletedAt?: Date | null;
};

export type Edge = {
  id: number;
  sourceId: number;
  targetId: number;
  relation: string;
  weight: number;
  confidence: number;
  evidence: Evidence[];
  firstSeen: Date;
  lastSeen: Date;
  properties: Record<string, unknown>;
};

export type AuditLog = {
  id: bigint;
  agentId: string;
  agentName?: string | null;
  action: string;
  resource: string;
  details: Record<string, any>;
  createdAt: Date;
};

export type ConsentRule = {
  id: number;
  agentId: string;
  resource: string;
  permission: 'read' | 'write' | 'none';
  grantedAt: Date;
  revokedAt?: Date | null;
};

export type TableRegistry = {
  tableName: string;
  description?: string | null;
  columns: ColumnMetadata[];
  recordCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type VectorCollection = {
  collection: string;
  description?: string | null;
  entryCount: number;
  embeddingDim: number;
  createdAt: Date;
  updatedAt: Date;
};

// =====================================================
// BILLING & METERING TABLES
// =====================================================

/**
 * Stripe subscription state (one per user)
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
    stripePriceId: varchar('stripe_price_id', { length: 255 }),
    status: varchar('status', { length: 30 })
      .notNull()
      .default('incomplete')
      .$type<'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'>(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_subscriptions_user').on(table.userId),
    stripeCustIdx: index('idx_subscriptions_stripe_cust').on(table.stripeCustomerId),
  })
);

/**
 * Stripe webhook idempotency (dedup by event ID)
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: varchar('event_id', { length: 255 }).notNull().unique(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    processedIdx: index('idx_stripe_events_processed').on(table.processedAt),
  })
);

/**
 * Daily usage snapshots (powers dashboard charts + per-agent breakdown)
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    resource: varchar('resource', { length: 50 })
      .notNull()
      .$type<'tables' | 'agents' | 'graph_entities' | 'api_calls' | 'mcp_calls'>(),
    count: integer('count').notNull().default(0),
    periodDate: timestamp('period_date', { mode: 'date' }).notNull().defaultNow(),
    agentId: varchar('agent_id', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDateIdx: index('idx_usage_user_date').on(table.userId, table.periodDate),
  })
);

/**
 * Unified payment records (Stripe invoices + x402 crypto)
 */
export const billingTransactions = pgTable(
  'billing_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    paymentType: varchar('payment_type', { length: 20 })
      .notNull()
      .$type<'stripe' | 'x402'>(),
    stripeInvoiceId: varchar('stripe_invoice_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    x402TxHash: varchar('x402_tx_hash', { length: 100 }),
    x402Network: varchar('x402_network', { length: 50 }),
    amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull().default('usd'),
    asset: varchar('asset', { length: 20 }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('pending')
      .$type<'pending' | 'succeeded' | 'failed' | 'refunded'>(),
    description: varchar('description', { length: 500 }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_billing_tx_user').on(table.userId, table.createdAt),
  })
);

// Billing type exports
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

export type BillingTransaction = typeof billingTransactions.$inferSelect;
export type NewBillingTransaction = typeof billingTransactions.$inferInsert;
