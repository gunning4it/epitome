export interface EpitomeClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  defaultCollection?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface SaveMemoryInput {
  text: string;
  collection?: string;
  metadata?: Record<string, unknown>;
}

export interface SaveMemoryResult {
  id: number | null;
  pendingId: number | null;
  collection: string;
  sourceRef: string;
  writeId: string;
  writeStatus: string;
  jobId: string | null;
}

export interface SearchMemoryInput {
  query: string;
  collection?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface SearchMemoryMatch {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  similarity: number;
  confidence: number;
  status: string;
  createdAt: string;
}

export interface SearchMemoryResult {
  results: SearchMemoryMatch[];
  total: number;
  query: string;
  minSimilarity: number;
}

export interface GetUserContextInput {
  topic?: string;
}

export interface UserContextTable {
  name: string;
  description?: string;
  recordCount: number;
}

export interface UserContextCollection {
  name: string;
  description?: string;
  entryCount: number;
}

export interface UserContextEntity {
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  mentionCount: number;
}

export interface UserContextMemory {
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  confidence: number | null;
  status: string | null;
  createdAt: string;
}

export interface UserContextHints {
  hasStructuredData: boolean;
  hasMemories: boolean;
  hasGraphData: boolean;
  suggestedTools: string[];
}

export interface UserContextRetrievalPlan {
  intent: Record<string, unknown>;
  scoredSources: Array<Record<string, unknown>>;
  recommendedCalls: Array<Record<string, unknown>>;
}

export interface GetUserContextResult {
  profile: Record<string, unknown> | null;
  tables: UserContextTable[];
  collections: UserContextCollection[];
  topEntities: UserContextEntity[];
  recentMemories: UserContextMemory[];
  hints: UserContextHints;
  retrievalPlan?: UserContextRetrievalPlan;
}

export interface GetProfileResult {
  data: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface UpdateProfileInput {
  patch: Record<string, unknown>;
}

export interface UpdateProfileResult {
  version: number;
  data: Record<string, unknown>;
  changedFields: string[];
  changedAt: string;
  sourceRef: string;
  writeId: string;
  writeStatus: string;
  jobId: string | null;
}

export interface QueryGraphInput {
  query?: string;
  type?: string;
  sql?: string;
  timeout?: number;
  limit?: number;
}

export interface QueryGraphResult {
  results: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

export interface QueryTableInput {
  table: string;
  filters?: Record<string, unknown>;
  sql?: string;
  limit?: number;
  offset?: number;
}

export interface QueryTableResult {
  records: Array<Record<string, unknown>>;
  total: number;
  executionTime: number;
}

export interface TableColumn {
  name: string;
  type: string;
}

export interface TableInfo {
  tableName: string;
  description: string | null;
  columns: TableColumn[];
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListTablesResult {
  tables: TableInfo[];
  total: number;
}

export interface AddRecordInput {
  table: string;
  data: Record<string, unknown>;
}

export interface AddRecordResult {
  id: number;
  tableName: string;
  sourceRef: string;
  writeId: string;
  writeStatus: string;
  jobId: string | null;
}
