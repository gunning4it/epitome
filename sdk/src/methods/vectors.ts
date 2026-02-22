import { EpitomeValidationError } from '../errors.js';
import { EpitomeHttpClient } from '../http.js';
import type {
  SaveMemoryInput,
  SaveMemoryResult,
  SearchMemoryInput,
  SearchMemoryResult,
} from '../types.js';

interface SaveMemoryResponseEnvelope {
  data: {
    id: number | null;
    pending_id: number | null;
    collection: string;
    sourceRef: string;
    writeId: string;
    writeStatus: string;
    jobId: string | null;
  };
}

interface SearchMemoryResponseEnvelope {
  data: Array<{
    id: number;
    collection: string;
    text: string;
    metadata: Record<string, unknown>;
    similarity: number;
    confidence: number;
    status: string;
    created_at: string;
  }>;
  meta: {
    total: number;
    query: string;
    minSimilarity: number;
  };
}

export async function saveMemoryMethod(
  http: EpitomeHttpClient,
  input: SaveMemoryInput,
  defaultCollection: string,
): Promise<SaveMemoryResult> {
  if (!input.text || input.text.trim().length === 0) {
    throw new EpitomeValidationError('saveMemory.text is required', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }

  const collection = normalizeCollection(input.collection ?? defaultCollection);
  const response = await http.request<SaveMemoryResponseEnvelope>({
    method: 'POST',
    path: `/vectors/${encodeURIComponent(collection)}/add`,
    body: {
      body: {
        text: input.text,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    },
  });

  return {
    id: response.data.id,
    pendingId: response.data.pending_id,
    collection: response.data.collection,
    sourceRef: response.data.sourceRef,
    writeId: response.data.writeId,
    writeStatus: response.data.writeStatus,
    jobId: response.data.jobId,
  };
}

export async function searchMemoryMethod(
  http: EpitomeHttpClient,
  input: SearchMemoryInput,
  defaultCollection: string,
): Promise<SearchMemoryResult> {
  if (!input.query || input.query.trim().length === 0) {
    throw new EpitomeValidationError('searchMemory.query is required', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }

  const collection = normalizeCollection(input.collection ?? defaultCollection);
  const response = await http.request<SearchMemoryResponseEnvelope>({
    method: 'POST',
    path: `/vectors/${encodeURIComponent(collection)}/search`,
    body: {
      body: {
        query: input.query,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.minSimilarity !== undefined
          ? { minSimilarity: input.minSimilarity }
          : {}),
      },
    },
  });

  return {
    results: response.data.map((item) => ({
      id: item.id,
      collection: item.collection,
      text: item.text,
      metadata: item.metadata,
      similarity: item.similarity,
      confidence: item.confidence,
      status: item.status,
      createdAt: item.created_at,
    })),
    total: response.meta.total,
    query: response.meta.query,
    minSimilarity: response.meta.minSimilarity,
  };
}

function normalizeCollection(value: string): string {
  const collection = value.trim();
  if (!collection) {
    throw new EpitomeValidationError('collection must not be empty', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }
  return collection;
}
