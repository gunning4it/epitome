/**
 * Canonical MCP tool contract.
 *
 * This is the only discoverable/public tool surface for MCP clients.
 * Tool descriptions are defined here once and imported by all 3 server
 * implementations (server.ts, protocol.ts, mcp-apps/server.ts).
 */
export const CANONICAL_MCP_TOOLS = ['recall', 'memorize', 'review'] as const;

export type CanonicalMcpToolName = (typeof CANONICAL_MCP_TOOLS)[number];

export function isCanonicalMcpToolName(name: string): name is CanonicalMcpToolName {
  return (CANONICAL_MCP_TOOLS as readonly string[]).includes(name);
}

/**
 * Shared tool descriptions for cross-model reliability.
 *
 * These descriptions encode recommended sequencing, relationship-query
 * hints, and mode selection guidance directly in the MCP definitions
 * so models don't need perfect tool-calling behavior to get good results.
 */
export const TOOL_DESCRIPTIONS: Record<CanonicalMcpToolName, string> = {
  recall: [
    "Retrieve the user's stored knowledge from Epitome.",
    'Call with NO arguments at the start of every conversation to load the user profile and see what data they track.',
    'Call with a topic string for relationship or knowledge questions (e.g., topic="my daughter", topic="books I\'ve read").',
    'Epitome resolves family roles, nicknames, and aliases automatically — just pass the natural query as the topic.',
    "Advanced: set mode to 'memory' (vector search), 'graph' (relationship traversal), or 'table' (structured SQL) with the corresponding options object.",
  ].join(' '),

  memorize: [
    'Save or delete a fact, experience, or event. Always provide text.',
    "For personal identity updates (name, family, diet, preferences), set category='profile' with a data object.",
    "For trackable items (books, meals, workouts), use storage='record' (default) with category and structured data fields.",
    "For unstructured notes (journal entries, reflections), use storage='memory'.",
    'Epitome auto-creates tables for new categories and detects contradictions after save.',
  ].join(' '),

  review: [
    'Check for or resolve memory contradictions.',
    'Use action="list" to see unresolved conflicts (max 5 returned).',
    'Use action="resolve" with a metaId and resolution ("confirm", "reject", or "keep_both") to fix one.',
    'Call this when the user corrects previously stored information or when you notice conflicting facts.',
  ].join(' '),
};
