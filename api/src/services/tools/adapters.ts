// api/src/services/tools/adapters.ts
import type { ToolResult } from './types.js';

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ChatGptToolResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Legacy /mcp adapter.
 *
 * Produces identical output to the current callTool() wrapper:
 * - Success: { content: [{ type: 'text', text: JSON.stringify(data) }] }
 * - Failure: { content: [{ type: 'text', text: message }], isError: true }
 */
export function mcpAdapter(result: ToolResult): McpToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.message }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result.data) }],
  };
}

/**
 * ChatGPT Apps /chatgpt-mcp adapter.
 *
 * Returns structuredContent for ChatGPT model reasoning + human-readable message in content.
 */
export function chatgptAdapter(result: ToolResult): ChatGptToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.message }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: result.message }],
    structuredContent: result.data as Record<string, unknown>,
  };
}
