/**
 * API Client for Epitome REST API
 * Base URL: http://localhost:3000/v1
 */

import type {
  Profile,
  Table,
  VectorSearchResult,
  VectorEntry,
  VectorCollection,
  Entity,
  MemoryReviewItem,
  ActivityLogEntry,
  AgentWithConsent,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/v1';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiOptions extends RequestInit {
  params?: Record<string, string | number | boolean>;
}

async function apiCall<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  // Build URL with query params
  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    url += `?${searchParams.toString()}`;
  }

  const res = await fetch(url, {
    ...fetchOptions,
    credentials: 'include', // Send session cookies
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(error.message || `API error: ${res.status}`, res.status);
  }

  return res.json();
}

// Profile API
export const profileApi = {
  get: () => apiCall<Profile>('/profile'),
  update: (data: Partial<Profile['data']>) => apiCall('/profile', {
    method: 'PATCH',
    body: JSON.stringify({ body: data }),
  }),
  history: () =>
    apiCall<{ data: Array<{
      version: number;
      data: Profile['data'];
      changedBy?: string;
      changedFields?: string[];
      changedAt?: string;
      updated_at?: string;
    }> }>('/profile/history').then((res) => {
      return res.data.map((item) => ({
        version: item.version,
        data: item.data,
        updated_at: item.updated_at || item.changedAt || new Date().toISOString(),
        changes: item.changedFields,
      }));
    }),
};

// Tables API
export const tablesApi = {
  list: () => apiCall<{ data: Table[]; meta: { total: number } }>('/tables').then((res) => res.data),
  query: (tableName: string, params: Record<string, unknown> = {}) => apiCall(`/tables/${tableName}/query`, {
    method: 'POST',
    body: JSON.stringify({ body: params }),
  }),
  insert: (tableName: string, data: Record<string, unknown>) => apiCall(`/tables/${tableName}/records`, {
    method: 'POST',
    body: JSON.stringify({ body: data }),
  }),
  update: (tableName: string, id: string, data: Record<string, unknown>) => apiCall(`/tables/${tableName}/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: data }),
  }),
  delete: (tableName: string, id: string) => apiCall(`/tables/${tableName}/records/${id}`, {
    method: 'DELETE',
  }),
};

// Vectors API
export const vectorsApi = {
  search: (collection: string, params: { query: string; limit?: number; minSimilarity?: number }) =>
    apiCall<{ data: VectorSearchResult[]; meta: Record<string, unknown> }>(`/vectors/${collection}/search`, {
      method: 'POST',
      body: JSON.stringify({ body: params }),
    }).then((res) => res.data),
  add: (collection: string, data: { text: string; metadata?: Record<string, unknown> }) =>
    apiCall(`/vectors/${collection}/add`, {
      method: 'POST',
      body: JSON.stringify({ body: data }),
    }),
  recent: (params?: { collection?: string; limit?: number; offset?: number }) =>
    apiCall<{ data: VectorEntry[]; meta: { total: number; limit: number; offset: number } }>('/vectors/recent', {
      params: params as Record<string, string | number | boolean> | undefined,
    }),
  collections: () =>
    apiCall<{ data: VectorCollection[]; meta: { total: number } }>('/vectors/collections')
      .then((res) => res.data),
};

// Graph API
export const graphApi = {
  entities: (params?: Record<string, string | number | boolean>) =>
    apiCall<{
      entities: Entity[];
      edges: Array<{
        id?: string | number;
        source_id: string;
        target_id: string;
        relation: string;
        weight: number;
        confidence?: number;
        status?: string | null;
        origin?: string | null;
      }>;
      meta: {
        total: number;
        edge_total?: number;
        edge_pagination?: { limit: number; offset: number; hasMore: boolean };
        stableMode?: boolean;
        stableConfidenceMin?: number;
      };
    }>('/graph/entities', { params }),
  entity: (id: string) => apiCall<Entity>(`/graph/entities/${id}`),
  neighbors: (id: string) =>
    apiCall<{
      neighbors: Array<{
        entity: Entity;
        relation: string;
        weight: number;
        edgeConfidence: number;
        sourceId: number;
        targetId: number;
      }>;
    }>(`/graph/entities/${id}/neighbors`).then((res) =>
      res.neighbors.map((neighbor) => ({
        ...neighbor.entity,
        edge: {
          relation: neighbor.relation,
          weight: neighbor.weight,
          confidence: neighbor.edgeConfidence,
        },
      }))
    ),
  updateEntity: (id: string, data: Partial<Pick<Entity, 'name' | 'properties'>>) =>
    apiCall(`/graph/entities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: data }),
    }),
  mergeEntities: (sourceId: string, targetId: string) =>
    apiCall(`/graph/entities/${sourceId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ body: { targetId: Number(targetId) } }),
    }),
  deleteEntity: (id: string) =>
    apiCall(`/graph/entities/${id}`, {
      method: 'DELETE',
    }),
};

// Memory Review API
export const memoryApi = {
  review: () =>
    apiCall<{ data: MemoryReviewItem[]; meta: Record<string, unknown> }>('/memory/review').then((res) => res.data),
  resolve: (id: string, action: 'confirm' | 'reject' | 'keep_both') =>
    apiCall(`/memory/review/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ body: { action } }),
    }),
};

// Activity Log API
export const activityApi = {
  list: (params?: Record<string, string | number | boolean>) =>
    apiCall<{ data: ActivityLogEntry[]; meta: { total: number } }>('/activity', { params }).then((res) => res.data),
};

// Agents API (consent)
export const agentsApi = {
  list: () =>
    apiCall<{ data: AgentWithConsent[] }>('/consent').then((res) => res.data),
  update: (agentId: string, permissions: Array<{ resource: string; permission: 'read' | 'write' | 'none' }>) =>
    apiCall<{ data: { agent_id: string; permissions: Array<{ resource: string; permission: string }> } }>(
      `/consent/${agentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ permissions }),
      }
    ),
  revoke: (agentId: string) =>
    apiCall<{ success: boolean }>(`/consent/${agentId}`, {
      method: 'DELETE',
    }),
  delete: (agentId: string) =>
    apiCall<{ success: boolean }>(`/consent/${agentId}/delete`, {
      method: 'DELETE',
    }),
};

// Auth API
export interface ApiKeyListItem {
  id: string;
  prefix: string;
  label: string;
  agentId: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface SessionData {
  user_id: string;
  email: string;
  name: string | null;
  tier: string;
  onboarded: boolean;
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    stripePriceId: string | null;
  } | null;
}

export const authApi = {
  session: () => apiCall<SessionData>('/auth/session'),
  logout: () => apiCall('/auth/logout', { method: 'POST' }),
  listApiKeys: () =>
    apiCall<{ data: ApiKeyListItem[]; meta: { total: number } }>('/auth/api-keys').then((res) => res.data),
  createApiKey: (params: { label: string; agent_id?: string; scopes?: string[]; expires_in_days?: number }) =>
    apiCall<{ data: { id: string; key: string; prefix: string; label: string; agentId: string | null; scopes: string[]; expiresAt: string | null }; meta: { warning: string } }>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  revokeApiKey: (id: string) =>
    apiCall('/auth/api-keys/' + id, { method: 'DELETE' }),
};

// Billing API
export interface BillingUsage {
  current: { tables: number; agents: number; graphEntities: number };
  limits: { maxTables: number; maxAgents: number; maxGraphEntities: number };
  history: Array<{ resource: string; date: string; count: number; agentId: string | null }>;
}

export interface BillingTransaction {
  id: string;
  paymentType: 'stripe' | 'x402';
  amountMicros: number;
  currency: string;
  asset: string | null;
  status: string;
  description: string | null;
  stripeInvoiceId: string | null;
  x402TxHash: string | null;
  x402Network: string | null;
  createdAt: string;
}

export const billingApi = {
  usage: () => apiCall<BillingUsage>('/billing/usage'),
  subscription: () =>
    apiCall<{ subscription: SessionData['subscription'] }>('/billing/subscription').then((r) => r.subscription),
  checkout: () => apiCall<{ url: string }>('/billing/checkout', { method: 'POST' }),
  portal: () => apiCall<{ url: string }>('/billing/portal', { method: 'POST' }),
  transactions: (params?: { limit?: number; offset?: number }) =>
    apiCall<{ data: BillingTransaction[]; meta: { total: number; limit: number; offset: number } }>(
      '/billing/transactions',
      { params: params as Record<string, string | number | boolean> | undefined }
    ),
};

export { apiCall };
