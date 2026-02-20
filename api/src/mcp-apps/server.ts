/**
 * ChatGPT Apps MCP Server Factory
 *
 * Creates a McpServer with all 10 Epitome tools registered using the service
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

/**
 * Create a ChatGPT Apps MCP server with all 10 tools.
 * Each request gets its own server instance (stateless mode).
 */
export function createChatGptMcpServer(): McpServer {
  const server = new McpServer({ name: 'epitome', version: '1.0.0' });

  server.registerTool('get_user_context', {
    description: 'Load user profile, preferences, top entities, and recent memories.',
    inputSchema: { topic: z.string().optional() },
    annotations: TOOL_ANNOTATIONS.get_user_context,
  }, wrapTool(tools.getUserContext));

  server.registerTool('update_profile', {
    description: 'Update user profile with deep merge (RFC 7396).',
    inputSchema: {
      data: z.record(z.string(), z.unknown()),
      reason: z.string().optional(),
    },
    annotations: TOOL_ANNOTATIONS.update_profile,
  }, wrapTool(tools.updateProfile));

  server.registerTool('list_tables', {
    description: 'List all user-tracked tables with schema and record counts.',
    inputSchema: {},
    annotations: TOOL_ANNOTATIONS.list_tables,
  }, wrapTool(tools.listTables));

  server.registerTool('query_table', {
    description: 'Query table records with filters or sandboxed SQL.',
    inputSchema: {
      table: z.string().optional(),
      tableName: z.string().optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      sql: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    annotations: TOOL_ANNOTATIONS.query_table,
  }, wrapTool(tools.queryTable));

  server.registerTool('add_record', {
    description: 'Insert a record into a table (auto-creates table if needed).',
    inputSchema: {
      table: z.string().optional(),
      tableName: z.string().optional(),
      data: z.record(z.string(), z.unknown()),
      tableDescription: z.string().optional(),
    },
    annotations: TOOL_ANNOTATIONS.add_record,
  }, wrapTool(tools.addRecord));

  server.registerTool('search_memory', {
    description: 'Semantic search across vector memory collections.',
    inputSchema: {
      collection: z.string(),
      query: z.string(),
      minSimilarity: z.number().optional(),
      limit: z.number().optional(),
    },
    annotations: TOOL_ANNOTATIONS.search_memory,
  }, wrapTool(tools.searchMemory));

  server.registerTool('save_memory', {
    description: 'Save text as searchable memory with vector embeddings.',
    inputSchema: {
      collection: z.string(),
      text: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: TOOL_ANNOTATIONS.save_memory,
  }, wrapTool(tools.saveMemory));

  server.registerTool('query_graph', {
    description: 'Traverse knowledge graph or run pattern-based queries.',
    inputSchema: {
      queryType: z.enum(['traverse', 'pattern']),
      entityId: z.number().optional(),
      relation: z.string().optional(),
      maxHops: z.number().optional(),
      pattern: z.union([
        z.string().min(1),
        z.object({
          entityType: z.string().optional(),
          entityName: z.string().optional(),
          relation: z.string().optional(),
          targetType: z.string().optional(),
        }),
      ]).optional(),
    },
    annotations: TOOL_ANNOTATIONS.query_graph,
  }, wrapTool(tools.queryGraph));

  server.registerTool('review_memories', {
    description: 'Get or resolve memory contradictions.',
    inputSchema: {
      action: z.enum(['list', 'resolve']),
      metaId: z.number().optional(),
      resolution: z.enum(['confirm', 'reject', 'keep_both']).optional(),
    },
    annotations: TOOL_ANNOTATIONS.review_memories,
  }, wrapTool(tools.reviewMemories));

  server.registerTool('retrieve_user_knowledge', {
    description: 'Retrieve everything Epitome knows about a topic. Searches across all data sources (profile, tables, vector memories, knowledge graph) in parallel and returns fused, deduplicated facts with provenance. Use this instead of manually calling list_tables + search_memory + query_graph. Budget controls depth: "small" (fast, 15 facts max), "medium" (default, 40 facts), "deep" (thorough, 80 facts).',
    inputSchema: {
      topic: z.string().min(1).max(500).describe('Topic to retrieve knowledge about'),
      budget: z.enum(['small', 'medium', 'deep']).optional().describe('Retrieval depth (default: "medium")'),
    },
    annotations: TOOL_ANNOTATIONS.retrieve_user_knowledge,
  }, wrapTool(tools.retrieveUserKnowledge));

  return server;
}
