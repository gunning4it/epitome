/**
 * MCP Protocol Server Factory
 *
 * Creates a McpServer instance with all 9 tools registered using the
 * official @modelcontextprotocol/sdk. Used by the Streamable HTTP handler
 * to speak proper JSON-RPC 2.0 with Claude Desktop and other MCP clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import type { McpContext } from './server.js';

// Tool handlers (legacy path)
import { getUserContext } from './tools/getUserContext.js';
import { updateProfile } from './tools/updateProfile.js';
import { listTables } from './tools/listTables.js';
import { queryTable } from './tools/queryTable.js';
import { addRecord } from './tools/addRecord.js';
import { searchMemory } from './tools/searchMemory.js';
import { saveMemory } from './tools/saveMemory.js';
import { queryGraph } from './tools/queryGraph.js';
import { reviewMemories } from './tools/reviewMemories.js';

// Service layer (feature-flagged path)
import * as toolServices from '@/services/tools/index.js';
import { mcpAdapter } from '@/services/tools/adapters.js';
import { buildToolContext } from '@/services/tools/context.js';

const USE_SERVICE_LAYER = process.env.MCP_USE_SERVICE_LAYER === 'true';

// Map tool names to service functions
const SERVICE_MAP: Record<string, (args: any, ctx: toolServices.ToolContext) => Promise<toolServices.ToolResult>> = {
  get_user_context: toolServices.getUserContext,
  update_profile: toolServices.updateProfile,
  list_tables: toolServices.listTables,
  query_table: toolServices.queryTable,
  add_record: toolServices.addRecord,
  search_memory: toolServices.searchMemory,
  save_memory: toolServices.saveMemory,
  query_graph: toolServices.queryGraph,
  review_memories: toolServices.reviewMemories,
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
 * Wrap a tool handler: extract auth context, call handler, return CallToolResult format.
 * When USE_SERVICE_LAYER is true and toolName is provided, routes through the
 * transport-agnostic service layer instead of the legacy handler.
 */
async function callTool(
  handler: (args: any, context: McpContext) => Promise<unknown>,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
  toolName?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  // Service layer path (feature-flagged)
  if (USE_SERVICE_LAYER && toolName && SERVICE_MAP[toolName]) {
    const rawContext = extractContext(extra);
    const toolContext = buildToolContext({
      userId: rawContext.userId,
      agentId: rawContext.agentId,
      tier: rawContext.tier,
      authType: 'api_key',
    });
    const result = await SERVICE_MAP[toolName](args, toolContext);
    return mcpAdapter(result);
  }

  // Legacy path (default)
  try {
    const context = extractContext(extra);
    const result = await handler(args, context);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('MCP protocol tool error', { error: message });
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}

/**
 * Create a new McpServer with all 9 Epitome tools registered.
 * Each request gets its own server instance (stateless mode).
 */
export function createMcpProtocolServer(): McpServer {
  const server = new McpServer({
    name: 'epitome',
    version: '1.0.0',
  });

  // 1. get_user_context
  server.registerTool('get_user_context', {
    description:
      "Load user's profile, preferences, and recent context. Call this at the start of every conversation to understand what you know about the user. Returns profile summary, top entities by relevance and confidence, table inventory, and vector collection list.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe('Optional topic for relevance ranking (e.g., "food preferences", "workout history")'),
    },
  }, async (args, extra) => callTool(getUserContext, args, extra, 'get_user_context'));

  // 2. update_profile
  server.registerTool('update_profile', {
    description:
      "Update user profile fields. Use this when the user shares personal information like allergies, dietary preferences, family members, timezone, job, or any other profile data. Deep-merges new data with existing profile. Returns updated profile.",
    inputSchema: {
      data: z
        .record(z.string(), z.unknown())
        .describe('Partial profile data to merge. Supports nested updates like {preferences: {dietary: ["vegetarian"]}}'),
      reason: z
        .string()
        .optional()
        .describe('Optional description of what changed (e.g., "user mentioned new allergy")'),
    },
  }, async (args, extra) => callTool(updateProfile, args, extra, 'update_profile'));

  // 3. list_tables
  server.registerTool('list_tables', {
    description:
      "List all data tables the user tracks (meals, workouts, expenses, habits, etc.). Returns table names, descriptions, column schemas, and record counts. Use this to discover what data is available before querying.",
    inputSchema: {},
  }, async (args, extra) => callTool(listTables, args, extra, 'list_tables'));

  // 4. query_table
  server.registerTool('query_table', {
    description:
      "Query records from a data table. Use structured filters for simple queries or SQL for complex analysis. Supports pagination. Returns matching records with metadata.",
    inputSchema: {
      table: z.string().optional().describe('Name of the table to query (e.g., "meals", "workouts")'),
      tableName: z.string().optional().describe('Deprecated alias for "table".'),
      filters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Structured filters as key-value pairs (e.g., {date: "2024-01-15", category: "dinner"})'),
      sql: z
        .string()
        .optional()
        .describe('Optional SQL SELECT query (read-only, sandboxed). Use for complex queries with JOINs, aggregations, etc.'),
      limit: z.number().optional().describe('Maximum number of results to return (default 50, max 1000)'),
      offset: z.number().optional().describe('Number of results to skip for pagination'),
    },
  }, async (args, extra) => callTool(queryTable, args, extra, 'query_table'));

  // 5. add_record
  server.registerTool('add_record', {
    description:
      "Add a new record to a table. Tables and columns are auto-created if they don't exist. Use this when the user logs meals, workouts, expenses, habits, medications, or any trackable data. Automatically extracts entities and creates graph connections.",
    inputSchema: {
      table: z.string().optional().describe('Name of the table (e.g., "meals", "workouts", "expenses")'),
      tableName: z.string().optional().describe('Deprecated alias for "table".'),
      data: z
        .record(z.string(), z.unknown())
        .describe('Record data as key-value pairs (e.g., {food: "pizza", calories: 800})'),
      tableDescription: z.string().optional().describe('Optional description of the table (used on first creation)'),
    },
  }, async (args, extra) => callTool(addRecord, args, extra, 'add_record'));

  // 6. search_memory
  server.registerTool('search_memory', {
    description:
      "Search user's saved memories using semantic similarity. Use this when the user asks about past conversations, experiences, notes, or anything they've told you before. Returns relevant memories ranked by similarity.",
    inputSchema: {
      collection: z.string().describe('Vector collection to search (e.g., "journal", "notes", "conversations")'),
      query: z.string().describe('Search query text (will be embedded and compared to stored vectors)'),
      minSimilarity: z.number().optional().describe('Minimum cosine similarity threshold (0-1, default 0.7)'),
      limit: z.number().optional().describe('Maximum number of results to return (default 10)'),
    },
  }, async (args, extra) => callTool(searchMemory, args, extra, 'search_memory'));

  // 7. save_memory
  server.registerTool('save_memory', {
    description:
      "Save user's experience, note, or important information as a searchable memory. Use this when the user shares experiences, reviews, reflections, ideas, or anything they might want to recall later. Automatically extracts entities and creates graph connections.",
    inputSchema: {
      collection: z.string().describe('Vector collection (e.g., "journal", "notes", "conversations")'),
      text: z.string().describe('Memory text to save (will be embedded for semantic search)'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional metadata (e.g., {topic: "food", mood: "happy"})'),
    },
  }, async (args, extra) => callTool(saveMemory, args, extra, 'save_memory'));

  // 8. query_graph
  server.registerTool('query_graph', {
    description:
      'Query the knowledge graph to find relationships and patterns. Use this for questions like "Who does Alex know?", "What\'s related to pizza?", "What food do I like?". Supports multi-hop traversal and pattern matching.',
    inputSchema: {
      queryType: z
        .enum(['traverse', 'pattern'])
        .describe('Query type: "traverse" for multi-hop navigation, "pattern" for entity/relation patterns'),
      entityId: z.number().optional().describe('For traverse: ID of entity to start traversal from'),
      relation: z.string().optional().describe('For traverse: relation type to follow (e.g., "likes", "knows")'),
      maxHops: z.number().optional().describe('For traverse: maximum hops to traverse (default 2, max 3)'),
      pattern: z
        .union([
          z.string().min(1),
          z.object({
            entityType: z.string().optional(),
            entityName: z.string().optional(),
            relation: z.string().optional(),
            targetType: z.string().optional(),
          }),
        ])
        .optional()
        .describe('For pattern: either natural language string or structured criteria object'),
    },
  }, async (args, extra) => callTool(queryGraph, args, extra, 'query_graph'));

  // 9. review_memories
  server.registerTool('review_memories', {
    description:
      'Review and resolve memory contradictions. Use this when data quality issues arise, when the user says "that\'s not right", or to check for conflicting information. Returns 0-5 contradictions with context. Can confirm, reject, or keep both memories.',
    inputSchema: {
      action: z
        .enum(['list', 'resolve'])
        .describe('Action: "list" to get contradictions, "resolve" to fix one'),
      metaId: z.number().optional().describe('For resolve: ID of memory_meta entry to resolve'),
      resolution: z
        .enum(['confirm', 'reject', 'keep_both'])
        .optional()
        .describe('For resolve: "confirm" to accept, "reject" to deny, "keep_both" to mark as contextual'),
    },
  }, async (args, extra) => callTool(reviewMemories, args, extra, 'review_memories'));

  return server;
}
