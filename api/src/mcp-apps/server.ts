/**
 * ChatGPT Apps MCP Server Factory
 *
 * Creates a McpServer with 3 intent-based facade Epitome tools using the service
 * layer and chatgptAdapter for response formatting. Tool annotations provide
 * readOnlyHint/destructiveHint/openWorldHint metadata for ChatGPT.
 *
 * Uses server.registerTool() directly (not registerAppTool from ext-apps)
 * because registerAppTool requires _meta.ui for UI-based apps, which doesn't
 * apply to this server-to-server transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as tools from '@/services/tools/index.js';
import { chatgptAdapter } from '@/services/tools/adapters.js';
import { buildToolContext } from '@/services/tools/context.js';
import { TOOL_ANNOTATIONS } from './annotations.js';
import { isCanonicalMcpToolName, TOOL_DESCRIPTIONS } from '@/mcp/toolsContract.js';

/**
 * Extract ToolContext from MCP authInfo extra.
 */
function extractContext(extra: Record<string, unknown>): tools.ToolContext {
  const authInfo = extra.authInfo as { extra?: Record<string, unknown> } | undefined;
  const userId = authInfo?.extra?.userId as string | undefined;
  const agentId = (authInfo?.extra?.agentId as string) || 'unknown-agent';
  const tier = (authInfo?.extra?.tier as string) || 'free';

  return buildToolContext({ userId: userId ?? '', agentId, tier, authType: 'api_key' });
}

/**
 * Wrap a tool service function for registerTool callback.
 */
function wrapTool<T>(
  serviceFn: (args: any, ctx: tools.ToolContext) => Promise<tools.ToolResult<T>>,
) {
  return async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
    const ctx = extractContext(extra);
    const result = await serviceFn(args, ctx);
    return chatgptAdapter(result);
  };
}

const SERVICE_MAP = {
  recall: wrapTool(tools.recall),
  memorize: wrapTool(tools.memorize),
  review: wrapTool(tools.review),
};

/**
 * Create a ChatGPT Apps MCP server with 3 facade tools.
 * Each request gets its own server instance (stateless mode).
 */
export function createChatGptMcpServer(): McpServer {
  const server = new McpServer({ name: 'epitome', version: '1.0.0' });

  server.registerTool('recall', {
    description: TOOL_DESCRIPTIONS.recall,
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
    annotations: TOOL_ANNOTATIONS.recall,
  }, SERVICE_MAP.recall);

  server.registerTool('memorize', {
    description: TOOL_DESCRIPTIONS.memorize,
    inputSchema: {
      text: z.string().min(1).describe('The fact/experience to save or forget (always required)'),
      category: z.string().optional().describe('Organizer: "books", "meals", "profile", etc.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Structured fields (e.g., {title: "Dune", rating: 5})'),
      action: z.enum(['save', 'delete']).optional().describe('Default "save"'),
      storage: z.enum(['record', 'memory']).optional().describe('Default "record". Use "memory" for vector-only unstructured saves.'),
      collection: z.string().optional().describe('For storage "memory": vector collection name. Defaults to category.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('For storage "memory": optional metadata. Defaults to data.'),
    },
    annotations: TOOL_ANNOTATIONS.memorize,
  }, SERVICE_MAP.memorize);

  server.registerTool('review', {
    description: TOOL_DESCRIPTIONS.review,
    inputSchema: {
      action: z.enum(['list', 'resolve']).describe('Action: "list" to get contradictions, "resolve" to fix one'),
      metaId: z.number().optional().describe('For resolve: ID of memory_meta entry to resolve'),
      resolution: z.enum(['confirm', 'reject', 'keep_both']).optional().describe('For resolve: how to handle the contradiction'),
    },
    annotations: TOOL_ANNOTATIONS.review,
  }, SERVICE_MAP.review);

  // Defensive assertion to keep this server aligned with canonical MCP tools.
  for (const name of Object.keys(SERVICE_MAP)) {
    if (!isCanonicalMcpToolName(name)) {
      throw new Error(`Invalid MCP tool registration: ${name}`);
    }
  }

  return server;
}
