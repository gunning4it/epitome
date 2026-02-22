import { EpitomeValidationError } from '../errors.js';
import { EpitomeHttpClient } from '../http.js';
import type {
  AddRecordInput,
  AddRecordResult,
  ListTablesResult,
  QueryTableInput,
  QueryTableResult,
} from '../types.js';

interface ListTablesResponseEnvelope {
  data: Array<{
    table_name: string;
    description: string | null;
    columns: Array<{ name: string; type: string }>;
    record_count: number;
    created_at: string;
    updated_at: string;
  }>;
  meta: {
    total: number;
  };
}

interface QueryTableResponseEnvelope {
  data: Array<Record<string, unknown>>;
  meta: {
    total: number;
    executionTime: number;
  };
}

interface AddRecordResponseEnvelope {
  data: {
    id: number;
    tableName: string;
    sourceRef: string;
    writeId: string;
    writeStatus: string;
    jobId: string | null;
  };
}

export async function listTablesMethod(
  http: EpitomeHttpClient,
): Promise<ListTablesResult> {
  const response = await http.request<ListTablesResponseEnvelope>({
    method: 'GET',
    path: '/tables',
  });

  return {
    tables: response.data.map((table) => ({
      tableName: table.table_name,
      description: table.description,
      columns: table.columns,
      recordCount: table.record_count,
      createdAt: table.created_at,
      updatedAt: table.updated_at,
    })),
    total: response.meta.total,
  };
}

export async function queryTableMethod(
  http: EpitomeHttpClient,
  input: QueryTableInput,
): Promise<QueryTableResult> {
  const table = normalizeTableName(input.table);
  const response = await http.request<QueryTableResponseEnvelope>({
    method: 'POST',
    path: `/tables/${encodeURIComponent(table)}/query`,
    body: {
      body: {
        ...(input.filters ? { filters: input.filters } : {}),
        ...(input.sql ? { sql: input.sql } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
      },
    },
  });

  return {
    records: response.data,
    total: response.meta.total,
    executionTime: response.meta.executionTime,
  };
}

export async function addRecordMethod(
  http: EpitomeHttpClient,
  input: AddRecordInput,
): Promise<AddRecordResult> {
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
    throw new EpitomeValidationError('addRecord.data must be an object', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }

  const table = normalizeTableName(input.table);
  const response = await http.request<AddRecordResponseEnvelope>({
    method: 'POST',
    path: `/tables/${encodeURIComponent(table)}/records`,
    body: {
      body: input.data,
    },
  });

  return response.data;
}

function normalizeTableName(value: string): string {
  if (!value || value.trim().length === 0) {
    throw new EpitomeValidationError('table is required', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }
  return value.trim();
}
