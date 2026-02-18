/**
 * Epitome MCP Server
 *
 * Model Context Protocol server exposing 9 tools for AI agents
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

import { getUserContext } from './tools/getUserContext.js';
import { updateProfile } from './tools/updateProfile.js';
import { listTables } from './tools/listTables.js';
import { queryTable } from './tools/queryTable.js';
import { addRecord } from './tools/addRecord.js';
import { searchMemory } from './tools/searchMemory.js';
import { saveMemory } from './tools/saveMemory.js';
import { queryGraph } from './tools/queryGraph.js';
import { reviewMemories } from './tools/reviewMemories.js';

/**
 * MCP Server Context
 *
 * Passed to all tool handlers
 */
export interface McpContext {
  userId: string;
  agentId: string;
}

/**
 * MCP Tool Registry
 */
const TOOLS = {
  get_user_context: getUserContext,
  update_profile: updateProfile,
  list_tables: listTables,
  query_table: queryTable,
  add_record: addRecord,
  search_memory: searchMemory,
  save_memory: saveMemory,
  query_graph: queryGraph,
  review_memories: reviewMemories,
};

/**
 * Get tool definitions
 */
export function getToolDefinitions() {
  return [
    {
      name: 'get_user_context',
      description: `Load user's profile, preferences, and recent context. Call this at the start of every conversation to understand what you know about the user. Returns profile summary, top entities by relevance and confidence, table inventory, and vector collection list.`,
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              'Optional topic for relevance ranking (e.g., "food preferences", "workout history")',
          },
        },
      },
    },
    {
      name: 'update_profile',
      description: `Update user profile fields. Use this when the user shares personal information like allergies, dietary preferences, family members, timezone, job, or any other profile data. Deep-merges new data with existing profile. Returns updated profile.`,
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Partial profile data to merge. Supports nested updates like {preferences: {dietary: ["vegetarian"]}}',
          },
          reason: {
            type: 'string',
            description: 'Optional description of what changed (e.g., "user mentioned new allergy")',
          },
        },
        required: ['data'],
      },
    },
    {
      name: 'list_tables',
      description: `List all data tables the user tracks (meals, workouts, expenses, habits, etc.). Returns table names, descriptions, column schemas, and record counts. Use this to discover what data is available before querying.`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'query_table',
      description: `Query records from a data table. Use structured filters for simple queries or SQL for complex analysis. Supports pagination. Returns matching records with metadata.`,
      inputSchema: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            description: 'Name of the table to query (e.g., "meals", "workouts")',
          },
          tableName: {
            type: 'string',
            description: 'Deprecated alias for "table".',
          },
          filters: {
            type: 'object',
            description:
              'Structured filters as key-value pairs (e.g., {date: "2024-01-15", category: "dinner"})',
          },
          sql: {
            type: 'string',
            description:
              'Optional SQL SELECT query (read-only, sandboxed). Use for complex queries with JOINs, aggregations, etc.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default 50, max 1000)',
          },
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination',
          },
        },
      },
    },
    {
      name: 'add_record',
      description: `Add a new record to a table. Tables and new columns are auto-created on the fly — send each piece of data as its own column. Use this when the user logs meals, workouts, expenses, habits, medications, or any trackable data. Automatically extracts entities and creates graph connections.

Column schema guidance for common tables:
- meals: {food: "dish name only", restaurant: "venue name", ingredients: "comma-separated list", meal_type: "breakfast|lunch|dinner|snack", calories: 800}
- workouts: {exercise: "exercise name", duration: 45, intensity: "low|moderate|high", calories_burned: 400, location: "gym name"}
- medications: {medication_name: "drug name", dose: "500mg", frequency: "twice daily", purpose: "reason"}
- expenses: {item: "what was bought", amount: 42.50, category: "groceries|dining|transport|etc", vendor: "store name"}

IMPORTANT: Keep each column value atomic. Put the dish/exercise/item NAME in the main column (food, exercise, item). Put restaurant/location, ingredients, category, etc. in separate columns. Do NOT concatenate descriptions into a single field.`,
      inputSchema: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            description: 'Name of the table (e.g., "meals", "workouts", "expenses")',
          },
          tableName: {
            type: 'string',
            description: 'Deprecated alias for "table".',
          },
          data: {
            type: 'object',
            description:
              'Record data as key-value pairs. Use separate columns for each piece of data — new columns are auto-created. Example: {food: "breakfast burrito", restaurant: "Crest Cafe", ingredients: "eggs, bacon, cheese", meal_type: "breakfast", calories: 650}',
          },
          tableDescription: {
            type: 'string',
            description: 'Optional description of the table (used on first creation)',
          },
        },
        required: ['data'],
      },
    },
    {
      name: 'search_memory',
      description: `Search user's saved memories using semantic similarity. Use this when the user asks about past conversations, experiences, notes, or anything they've told you before. Returns relevant memories ranked by similarity.`,
      inputSchema: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            description: 'Vector collection to search (e.g., "journal", "notes", "conversations")',
          },
          query: {
            type: 'string',
            description: 'Search query text (will be embedded and compared to stored vectors)',
          },
          minSimilarity: {
            type: 'number',
            description: 'Minimum cosine similarity threshold (0-1, default 0.7)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default 10)',
          },
        },
        required: ['collection', 'query'],
      },
    },
    {
      name: 'save_memory',
      description: `Save user's experience, note, or important information as a searchable memory. Use this when the user shares experiences, reviews, reflections, ideas, or anything they might want to recall later. Automatically extracts entities and creates graph connections.`,
      inputSchema: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            description: 'Vector collection (e.g., "journal", "notes", "conversations")',
          },
          text: {
            type: 'string',
            description: 'Memory text to save (will be embedded for semantic search)',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata (e.g., {topic: "food", mood: "happy"})',
          },
        },
        required: ['collection', 'text'],
      },
    },
    {
      name: 'query_graph',
      description: `Query the knowledge graph to find relationships and patterns. Use this for questions like "Who does Alex know?", "What's related to pizza?", "What food do I like?". Supports multi-hop traversal and pattern matching.`,
      inputSchema: {
        type: 'object',
        properties: {
          queryType: {
            type: 'string',
            enum: ['traverse', 'pattern'],
            description:
              'Query type: "traverse" for multi-hop navigation, "pattern" for entity/relation patterns',
          },
          entityId: {
            type: 'number',
            description: 'For traverse: ID of entity to start traversal from',
          },
          relation: {
            type: 'string',
            description: 'For traverse: relation type to follow (e.g., "likes", "knows")',
          },
          maxHops: {
            type: 'number',
            description: 'For traverse: maximum hops to traverse (default 2, max 3)',
          },
          pattern: {
            oneOf: [
              {
                type: 'string',
                description: 'Natural-language pattern (e.g., "what food do I like?")',
              },
              {
                type: 'object',
                description:
                  'Structured pattern criteria (e.g., {entityType: "food", relation: "likes", targetType: "*"})',
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
    },
    {
      name: 'review_memories',
      description: `Review and resolve memory contradictions. Use this when data quality issues arise, when the user says "that's not right", or to check for conflicting information. Returns 0-5 contradictions with context. Can confirm, reject, or keep both memories.`,
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
            description:
              'For resolve: "confirm" to accept, "reject" to deny, "keep_both" to mark as contextual',
          },
        },
        required: ['action'],
      },
    },
  ];
}

/**
 * Execute MCP tool call
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  context: McpContext
): Promise<unknown> {
  const tool = TOOLS[toolName as keyof typeof TOOLS];

  if (!tool) {
    throw new Error(`TOOL_NOT_FOUND: Unknown tool '${toolName}'`);
  }

  return await (tool as (args: unknown, context: McpContext) => Promise<unknown>)(args, context);
}
