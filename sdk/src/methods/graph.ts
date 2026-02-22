import { EpitomeValidationError } from '../errors.js';
import { EpitomeHttpClient } from '../http.js';
import type {
  QueryGraphInput,
  QueryGraphResult,
} from '../types.js';

interface QueryGraphResponseEnvelope {
  results: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

export async function queryGraphMethod(
  http: EpitomeHttpClient,
  input: QueryGraphInput,
): Promise<QueryGraphResult> {
  if (!input.query && !input.sql) {
    throw new EpitomeValidationError(
      'queryGraph requires either query or sql',
      {
        status: 400,
        code: 'INVALID_ARGS',
      },
    );
  }

  const response = await http.request<QueryGraphResponseEnvelope>({
    method: 'POST',
    path: '/graph/query',
    body: {
      ...(input.query ? { query: input.query } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.sql ? { sql: input.sql } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    },
  });

  return {
    results: response.results,
    meta: response.meta,
  };
}
