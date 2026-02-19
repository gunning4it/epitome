// api/src/services/tools/types.ts

/**
 * Transport-agnostic types for MCP tool services.
 *
 * Tool services return ToolResult instead of throwing.
 * Transport adapters (/mcp, /chatgpt-mcp) map these to wire format.
 */

export type Tier = 'free' | 'pro' | 'enterprise';
export type AuthType = 'session' | 'api_key';

export interface ToolContext {
  userId: string;
  agentId: string;
  tier: Tier;
  authType: AuthType;
  schemaName: string;
  requestId: string;
}

export enum ToolErrorCode {
  CONSENT_DENIED = 'CONSENT_DENIED',
  INVALID_ARGS = 'INVALID_ARGS',
  NOT_FOUND = 'NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  SCHEMA_ERROR = 'SCHEMA_ERROR',
}

export interface ToolSuccess<T = unknown> {
  success: true;
  data: T;
  message: string;
  meta?: {
    pagination?: { offset: number; limit: number; total: number };
    warnings?: string[];
    source?: string;
  };
}

export interface ToolFailure {
  success: false;
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

/** Helper to create a success result */
export function toolSuccess<T>(data: T, message: string, meta?: ToolSuccess['meta']): ToolSuccess<T> {
  return { success: true, data, message, meta };
}

/** Helper to create a failure result */
export function toolFailure(code: ToolErrorCode, message: string, retryable = false, details?: Record<string, unknown>): ToolFailure {
  return { success: false, code, message, retryable, details };
}
