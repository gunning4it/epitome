/**
 * MCP Protocol Server Factory
 *
 * Creates a McpServer instance with 3 intent-based facade tools using the
 * official @modelcontextprotocol/sdk. Used by the Streamable HTTP handler
 * to speak proper JSON-RPC 2.0 with Claude Desktop and other MCP clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import type { McpContext } from './server.js';
import { isCanonicalMcpToolName, type CanonicalMcpToolName } from './toolsContract.js';

// Service layer (always used)
import * as toolServices from '@/services/tools/index.js';
import { mcpAdapter } from '@/services/tools/adapters.js';
import { buildToolContext } from '@/services/tools/context.js';

// Map tool names to service functions
const SERVICE_MAP: Record<
  CanonicalMcpToolName,
  (args: any, ctx: toolServices.ToolContext) => Promise<toolServices.ToolResult>
> = {
  recall: toolServices.recall,
  memorize: toolServices.memorize,
  review: toolServices.review,
};

/**
 * Extract userId and agentId from the transport's authInfo.extra
 */
function extractContext(extra: Record<string, unknown>): McpContext {
  const authInfo = extra.authInfo as { extra?: { userId?: string; agentId?: string; tier?: string } } | undefined;
  const userId = authInfo?.extra?.userId;
  const agentId = authInfo?.extra?.agentId || 'unknown-agent';
  const tier = authInfo?.extra?.tier || 'free';

  if (!userId) {
    throw new Error('UNAUTHORIZED: Authentication required.');
  }

  return { userId, agentId, tier };
}

/**
 * Route a tool call through the service layer.
 * Always uses SERVICE_MAP — no legacy fallback.
 */
async function callTool(
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
  toolName: string,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!isCanonicalMcpToolName(toolName)) {
    return {
      content: [{ type: 'text', text: `TOOL_NOT_FOUND: Unknown tool '${toolName}'.` }],
      isError: true,
    };
  }
  const serviceFn = SERVICE_MAP[toolName];

  try {
    const rawContext = extractContext(extra);
    const toolContext = buildToolContext({
      userId: rawContext.userId,
      agentId: rawContext.agentId,
      tier: rawContext.tier,
      authType: 'api_key',
    });
    const result = await serviceFn(args, toolContext);
    return mcpAdapter(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('MCP protocol tool error', { error: message, toolName });
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}

/**
 * Create a new McpServer with 3 facade Epitome tools registered.
 * Each request gets its own server instance (stateless mode).
 */
export function createMcpProtocolServer(): McpServer {
  const server = new McpServer({
    name: 'epitome',
    version: '1.0.0',
  });

  // 1. recall
  server.registerTool('recall', {
    description:
      "Retrieve information Epitome knows about a topic. Default: leave topic empty for user context, provide topic for federated search. Advanced: set mode to 'memory', 'graph', or 'table' with the corresponding options object for direct queries (e.g., SQL via mode='table').",
    inputSchema: {
      topic: z.string().optional().describe('What to search for. Empty = general context at conversation start.'),
      budget: z.enum(['small', 'medium', 'deep']).optional().describe('small=quick, medium=default, deep=research only'),
      mode: z.enum(['context', 'knowledge', 'memory', 'graph', 'table']).optional().describe('Routing mode. Default: auto (no topic=context, topic=knowledge).'),
      memory: z.object({
        collection: z.string().describe('Vector collection to search'),
        query: z.string().describe('Search query text'),
        minSimilarity: z.number().optional().describe('Min cosine similarity (0-1, default 0.7)'),
        limit: z.number().optional().describe('Max results (default 10)'),
      }).optional().describe('For mode "memory": vector search options'),
      graph: z.object({
        queryType: z.enum(['traverse', 'pattern']).describe('Query type'),
        entityId: z.number().optional().describe('For traverse: starting entity ID'),
        relation: z.string().optional().describe('For traverse: relation type to follow'),
        maxHops: z.number().optional().describe('For traverse: max hops (default 2, max 3)'),
        pattern: z.union([
          z.string().min(1),
          z.object({
            entityType: z.string().optional(),
            entityName: z.string().optional(),
            relation: z.string().optional(),
            targetType: z.string().optional(),
          }),
        ]).optional().describe('For pattern: natural language or structured criteria'),
      }).optional().describe('For mode "graph": graph query options'),
      table: z.union([
        z.string().min(1),
        z.object({
          table: z.string().optional().describe('Table name'),
          tableName: z.string().optional().describe('Deprecated alias for "table"'),
          filters: z.record(z.string(), z.unknown()).optional().describe('Structured filters'),
          sql: z.string().optional().describe('SQL SELECT query (read-only, sandboxed)'),
          limit: z.number().optional().describe('Max results (default 50, max 1000)'),
          offset: z.number().optional().describe('Pagination offset'),
        }),
      ]).optional().describe('For mode "table": table name string or query options object'),
      tableName: z.string().optional().describe('Top-level table shorthand (normalized into table mode query)'),
      filters: z.record(z.string(), z.unknown()).optional().describe('Top-level filters shorthand for table mode'),
      sql: z.string().optional().describe('Top-level SQL shorthand for table mode'),
      limit: z.number().optional().describe('Top-level limit shorthand for table mode'),
      offset: z.number().optional().describe('Top-level offset shorthand for table mode'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  }, async (args, extra) => callTool(args, extra, 'recall'));

  // 2. memorize
  server.registerTool('memorize', {
    description:
      "Save or delete a fact, experience, or event. Always provide text. Use storage='memory' for unstructured notes (journal, reflections). Use storage='record' (default) with structured data for trackable items. Set category='profile' for identity updates.",
    inputSchema: {
      text: z.string().min(1).describe('The fact/experience to save or forget (always required)'),
      category: z.string().optional().describe('Organizer: "books", "meals", "profile", etc.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Structured fields (e.g., {title: "Dune", rating: 5})'),
      action: z.enum(['save', 'delete']).optional().describe('Default "save"'),
      storage: z.enum(['record', 'memory']).optional().describe('Default "record". Use "memory" for vector-only unstructured saves.'),
      collection: z.string().optional().describe('For storage "memory": vector collection name. Defaults to category.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('For storage "memory": optional metadata. Defaults to data.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  }, async (args, extra) => callTool(args, extra, 'memorize'));

  // 3. review
  server.registerTool('review', {
    description:
      'Check for or resolve memory contradictions. Use "list" to see conflicts, "resolve" with a metaId and resolution to fix one.',
    inputSchema: {
      action: z.enum(['list', 'resolve']).describe('Action: "list" to get contradictions, "resolve" to fix one'),
      metaId: z.number().optional().describe('For resolve: ID of memory_meta entry to resolve'),
      resolution: z.enum(['confirm', 'reject', 'keep_both']).optional().describe('For resolve: how to handle the contradiction'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  }, async (args, extra) => callTool(args, extra, 'review'));

  return server;
}
