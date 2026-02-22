import { jsonSchema } from 'ai';

export interface SearchMemoryToolInput {
  query: string;
  collection?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface SaveMemoryToolInput {
  text: string;
  collection?: string;
  metadata?: Record<string, unknown>;
}

export interface GetUserContextToolInput {
  topic?: string;
}

export interface SearchMemoryToolOutput {
  results: Array<{
    id: number;
    collection: string;
    text: string;
    metadata: Record<string, unknown>;
    similarity: number;
    confidence: number;
    status: string;
    createdAt: string;
  }>;
  total: number;
  query: string;
  minSimilarity: number;
}

export interface SaveMemoryToolOutput {
  id: number | null;
  pendingId: number | null;
  collection: string;
  sourceRef: string;
  writeId: string;
  writeStatus: string;
  jobId: string | null;
}

export interface GetUserContextToolOutput {
  profile: Record<string, unknown> | null;
  tables: Array<{
    name: string;
    description?: string;
    recordCount: number;
  }>;
  collections: Array<{
    name: string;
    description?: string;
    entryCount: number;
  }>;
  topEntities: Array<{
    type: string;
    name: string;
    properties: Record<string, unknown>;
    confidence: number;
    mentionCount: number;
  }>;
  recentMemories: Array<{
    collection: string;
    text: string;
    metadata: Record<string, unknown>;
    confidence: number | null;
    status: string | null;
    createdAt: string;
  }>;
  hints: {
    hasStructuredData: boolean;
    hasMemories: boolean;
    hasGraphData: boolean;
    suggestedTools: string[];
  };
  retrievalPlan?: Record<string, unknown>;
}

export const searchMemoryToolInputSchema = jsonSchema<SearchMemoryToolInput>({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Semantic query text to search in memory.',
      minLength: 1,
      maxLength: 1000,
    },
    collection: {
      type: 'string',
      description: 'Optional vector collection name. Defaults to configured collection.',
      minLength: 1,
      maxLength: 100,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of matches to return.',
      minimum: 1,
      maximum: 100,
    },
    minSimilarity: {
      type: 'number',
      description: 'Cosine similarity threshold between 0 and 1.',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['query'],
  additionalProperties: false,
});

export const saveMemoryToolInputSchema = jsonSchema<SaveMemoryToolInput>({
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'Memory text to persist.',
      minLength: 1,
      maxLength: 50000,
    },
    collection: {
      type: 'string',
      description: 'Optional vector collection. Defaults to configured collection.',
      minLength: 1,
      maxLength: 100,
    },
    metadata: {
      type: 'object',
      description: 'Optional metadata object attached to the memory.',
      additionalProperties: true,
    },
  },
  required: ['text'],
  additionalProperties: false,
});

export const getUserContextToolInputSchema = jsonSchema<GetUserContextToolInput>({
  type: 'object',
  properties: {
    topic: {
      type: 'string',
      description: 'Optional topic hint to guide context retrieval.',
      minLength: 1,
      maxLength: 500,
    },
  },
  additionalProperties: false,
});

export const searchMemoryToolOutputSchema = jsonSchema<SearchMemoryToolOutput>({
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          collection: { type: 'string' },
          text: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          similarity: { type: 'number' },
          confidence: { type: 'number' },
          status: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: [
          'id',
          'collection',
          'text',
          'metadata',
          'similarity',
          'confidence',
          'status',
          'createdAt',
        ],
        additionalProperties: false,
      },
    },
    total: { type: 'integer' },
    query: { type: 'string' },
    minSimilarity: { type: 'number' },
  },
  required: ['results', 'total', 'query', 'minSimilarity'],
  additionalProperties: false,
});

export const saveMemoryToolOutputSchema = jsonSchema<SaveMemoryToolOutput>({
  type: 'object',
  properties: {
    id: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    pendingId: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    collection: { type: 'string' },
    sourceRef: { type: 'string' },
    writeId: { type: 'string' },
    writeStatus: { type: 'string' },
    jobId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'id',
    'pendingId',
    'collection',
    'sourceRef',
    'writeId',
    'writeStatus',
    'jobId',
  ],
  additionalProperties: false,
});

export const getUserContextToolOutputSchema = jsonSchema<GetUserContextToolOutput>({
  type: 'object',
  properties: {
    profile: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          recordCount: { type: 'integer' },
        },
        required: ['name', 'recordCount'],
        additionalProperties: false,
      },
    },
    collections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          entryCount: { type: 'integer' },
        },
        required: ['name', 'entryCount'],
        additionalProperties: false,
      },
    },
    topEntities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          name: { type: 'string' },
          properties: { type: 'object', additionalProperties: true },
          confidence: { type: 'number' },
          mentionCount: { type: 'integer' },
        },
        required: ['type', 'name', 'properties', 'confidence', 'mentionCount'],
        additionalProperties: false,
      },
    },
    recentMemories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          collection: { type: 'string' },
          text: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          confidence: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          status: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          createdAt: { type: 'string' },
        },
        required: [
          'collection',
          'text',
          'metadata',
          'confidence',
          'status',
          'createdAt',
        ],
        additionalProperties: false,
      },
    },
    hints: {
      type: 'object',
      properties: {
        hasStructuredData: { type: 'boolean' },
        hasMemories: { type: 'boolean' },
        hasGraphData: { type: 'boolean' },
        suggestedTools: { type: 'array', items: { type: 'string' } },
      },
      required: ['hasStructuredData', 'hasMemories', 'hasGraphData', 'suggestedTools'],
      additionalProperties: false,
    },
    retrievalPlan: { type: 'object', additionalProperties: true },
  },
  required: [
    'profile',
    'tables',
    'collections',
    'topEntities',
    'recentMemories',
    'hints',
  ],
  additionalProperties: false,
});
