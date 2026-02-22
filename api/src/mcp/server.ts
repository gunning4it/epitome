/**
 * Epitome MCP Server
 *
 * Model Context Protocol server exposing 3 intent-based facade tools for AI agents
 * Simplified HTTP-based implementation without SDK transport layer
 *
 * Architecture:
 * - Shares process and database pool with REST API
 * - Enforces consent rules on every tool invocation
 * - Audits all tool calls
 * - Direct JSON-RPC style request/response handling
 *
 * Reference: EPITOME_TECH_SPEC.md §8, §11
 */

// Service layer for facade tools
import * as toolServices from '@/services/tools/index.js';
import { buildToolContext } from '@/services/tools/context.js';
import { CANONICAL_MCP_TOOLS, isCanonicalMcpToolName, type CanonicalMcpToolName } from './toolsContract.js';

/**
 * MCP Server Context
 *
 * Passed to all tool handlers
 */
export interface McpContext {
  userId: string;
  agentId: string;
  tier: string;
}

// Facade tools use the service layer directly
const FACADE_TOOLS: Record<
  CanonicalMcpToolName,
  (args: any, ctx: toolServices.ToolContext) => Promise<toolServices.ToolResult>
> = {
  recall: toolServices.recall,
  memorize: toolServices.memorize,
  review: toolServices.review,
};

/**
 * Get tool definitions
 */
export function getToolDefinitions() {
  const definitions = [
    {
      name: 'recall',
      description: "Retrieve information Epitome knows about a topic. Default: leave topic empty for user context, provide topic for federated search. Advanced: set mode to 'memory', 'graph', or 'table' with the corresponding options object for direct queries (e.g., SQL via mode='table').",
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'What to search for. Empty = general context at conversation start.',
          },
          budget: {
            type: 'string',
            enum: ['small', 'medium', 'deep'],
            description: 'small=quick, medium=default, deep=research only',
          },
          mode: {
            type: 'string',
            enum: ['context', 'knowledge', 'memory', 'graph', 'table'],
            description: 'Routing mode. Default: auto (no topic=context, topic=knowledge).',
          },
          memory: {
            type: 'object',
            description: 'For mode "memory": vector search options',
            properties: {
              collection: { type: 'string', description: 'Vector collection to search' },
              query: { type: 'string', description: 'Search query text' },
              minSimilarity: { type: 'number', description: 'Min cosine similarity (0-1, default 0.7)' },
              limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['collection', 'query'],
          },
          graph: {
            type: 'object',
            description: 'For mode "graph": graph query options',
            properties: {
              queryType: {
                type: 'string',
                enum: ['traverse', 'pattern'],
                description: 'Query type',
              },
              entityId: { type: 'number', description: 'For traverse: starting entity ID' },
              relation: { type: 'string', description: 'For traverse: relation type to follow' },
              maxHops: { type: 'number', description: 'For traverse: max hops (default 2, max 3)' },
              pattern: {
                oneOf: [
                  { type: 'string', description: 'Natural-language pattern' },
                  {
                    type: 'object',
                    description: 'Structured pattern criteria',
                    properties: {
                      entityType: { type: 'string' },
                      entityName: { type: 'string' },
                      relation: { type: 'string' },
                      targetType: { type: 'string' },
                    },
                  },
                ],
              },
            },
            required: ['queryType'],
          },
          table: {
            oneOf: [
              { type: 'string', description: 'Table name shorthand' },
              {
                type: 'object',
                description: 'Table query options',
                properties: {
                  table: { type: 'string', description: 'Table name' },
                  tableName: { type: 'string', description: 'Deprecated alias for "table"' },
                  filters: { type: 'object', description: 'Structured filters' },
                  sql: { type: 'string', description: 'SQL SELECT query (read-only, sandboxed)' },
                  limit: { type: 'number', description: 'Max results (default 50, max 1000)' },
                  offset: { type: 'number', description: 'Pagination offset' },
                },
              },
            ],
            description: 'For mode "table": table name string or query options object',
          },
          tableName: { type: 'string', description: 'Top-level table shorthand for mode "table"' },
          filters: { type: 'object', description: 'Top-level filters shorthand for mode "table"' },
          sql: { type: 'string', description: 'Top-level SQL shorthand for mode "table"' },
          limit: { type: 'number', description: 'Top-level limit shorthand for mode "table"' },
          offset: { type: 'number', description: 'Top-level offset shorthand for mode "table"' },
        },
      },
    },
    {
      name: 'memorize',
      description: "Save or delete a fact, experience, or event. Always provide text. Use storage='memory' for unstructured notes (journal, reflections). Use storage='record' (default) with structured data for trackable items. Set category='profile' for identity updates.",
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The fact/experience to save or forget (always required)',
          },
          category: {
            type: 'string',
            description: 'Organizer: "books", "meals", "profile", etc.',
          },
          data: {
            type: 'object',
            description: 'Structured fields (e.g., {title: "Dune", rating: 5})',
          },
          action: {
            type: 'string',
            enum: ['save', 'delete'],
            description: 'Default "save"',
          },
          storage: {
            type: 'string',
            enum: ['record', 'memory'],
            description: 'Default "record". Use "memory" for vector-only unstructured saves.',
          },
          collection: {
            type: 'string',
            description: 'For storage "memory": vector collection name. Defaults to category.',
          },
          metadata: {
            type: 'object',
            description: 'For storage "memory": optional metadata. Defaults to data.',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'review',
      description: 'Check for or resolve memory contradictions. Use "list" to see conflicts, "resolve" with a metaId and resolution to fix one.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'resolve'],
            description: 'Action: "list" to get contradictions, "resolve" to fix one',
          },
          metaId: {
            type: 'number',
            description: 'For resolve: ID of memory_meta entry to resolve',
          },
          resolution: {
            type: 'string',
            enum: ['confirm', 'reject', 'keep_both'],
            description: 'For resolve: how to handle the contradiction',
          },
        },
        required: ['action'],
      },
    },
  ];

  const names = definitions.map((definition) => definition.name).sort();
  const canonicalNames = [...CANONICAL_MCP_TOOLS].sort();
  if (JSON.stringify(names) !== JSON.stringify(canonicalNames)) {
    throw new Error(
      `Tool definition drift detected. Expected [${canonicalNames.join(', ')}], got [${names.join(', ')}].`,
    );
  }

  return definitions;
}

/**
 * Execute MCP tool call.
 *
 * Returns raw ToolResult so the caller (handler.ts) can distinguish
 * success from failure and set the appropriate HTTP status code.
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  context: McpContext
): Promise<toolServices.ToolResult> {
  if (!isCanonicalMcpToolName(toolName)) {
    throw new Error(`TOOL_NOT_FOUND: Unknown tool '${toolName}'`);
  }
  const facadeTool = FACADE_TOOLS[toolName];

  const toolContext = buildToolContext({
    userId: context.userId,
    agentId: context.agentId,
    tier: context.tier,
    authType: 'api_key',
  });
  return facadeTool(args, toolContext);
}
