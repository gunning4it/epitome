/**
 * Type definitions for Epitome Dashboard
 */

export interface Profile {
  user_id: string;
  data: {
    name?: string;
    timezone?: string;
    dietary_restrictions?: string[];
    family?: Array<{ name: string; relation: string; [key: string]: unknown }>
           | Record<string, { name: string; birthday?: string; [key: string]: unknown }>;
    work?: {
      role?: string;
      company?: string;
    };
    career?: {
      primary_job?: {
        title?: string;
        company?: string;
      };
      [key: string]: unknown;
    };
    preferences?: {
      food?: {
        favorites?: string[];
        regional_style?: string;
      };
      [key: string]: unknown;
    };
    health?: {
      conditions?: string[];
      dietary_goals?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  version: number;
  updated_at: string;
}

export interface ProfileVersion {
  version: number;
  data: Profile['data'];
  updated_at: string;
  changes?: string[];
}

export interface Table {
  table_name: string;
  description?: string;
  record_count: number;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
}

export interface VectorSearchResult {
  id: string;
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  similarity: number;
  confidence: number;
  created_at: string;
}

export interface VectorEntry {
  id: number;
  collection: string;
  text: string;
  metadata: Record<string, unknown>;
  confidence: number;
  status: string;
  created_at: string;
}

export interface VectorCollection {
  collection: string;
  description: string | null;
  entry_count: number;
  created_at: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  mention_count: number;
  first_seen: string;
  last_seen: string;
  confidence: number;
}

export interface Edge {
  id?: string | number;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  confidence?: number;
  status?: string | null;
  origin?: string | null;
  properties?: Record<string, unknown>;
}

export interface GraphData {
  nodes: Entity[];
  edges: Edge[];
}

export interface Contradiction {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  oldMetaId: number;
  newMetaId: number;
  agent: string;
  detectedAt: string;
  resolution: string;
}

export interface MemoryReviewItem {
  id: number;
  sourceType: string;
  sourceRef: string;
  confidence: number;
  status: string;
  contradictions: Contradiction[];
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  agent_id: string;
  agent_name?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details?: Record<string, unknown> & {
    pipeline?: {
      writeId?: string | null;
      stage?: string | null;
      sourceRef?: string | null;
      jobId?: number | null;
      metaId?: number | null;
      vectorId?: number | null;
      writeStatus?: string | null;
      latencyMs?: number | null;
      error?: string | null;
    };
  };
  timestamp: string;
}

export interface AgentWithConsent {
  agent_id: string;
  agent_name: string | null;
  permissions: Array<{ resource: string; permission: 'read' | 'write' }>;
  last_used: string | null;
  created_at: string;
}
