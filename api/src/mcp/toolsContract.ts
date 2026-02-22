/**
 * Canonical MCP tool contract.
 *
 * This is the only discoverable/public tool surface for MCP clients.
 */
export const CANONICAL_MCP_TOOLS = ['recall', 'memorize', 'review'] as const;

export type CanonicalMcpToolName = (typeof CANONICAL_MCP_TOOLS)[number];

export function isCanonicalMcpToolName(name: string): name is CanonicalMcpToolName {
  return (CANONICAL_MCP_TOOLS as readonly string[]).includes(name);
}
