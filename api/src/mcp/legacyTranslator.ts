type JsonObject = Record<string, unknown>;

export interface LegacyToolTranslation {
  toolName: string;
  args: Record<string, unknown>;
}

export interface LegacyRewriteEvent {
  fromToolName: string;
  toToolName: string;
}

const LEGACY_TOOL_NAMES = new Set([
  'get_user_context',
  'retrieve_user_knowledge',
  'list_tables',
  'query_table',
  'search_memory',
  'query_graph',
  'add_record',
  'save_memory',
  'update_profile',
  'review_memories',
]);

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function legacyTableName(args: JsonObject): string | null {
  if (isNonEmptyString(args.table)) {
    return args.table.trim();
  }
  if (isNonEmptyString(args.tableName)) {
    return args.tableName.trim();
  }
  return null;
}

function compactObject(obj: JsonObject): JsonObject {
  const compacted: JsonObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted;
}

function stringifyValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function synthesizeAddRecordText(table: string, data: JsonObject): string {
  const kv = Object.entries(data).map(([key, value]) => `${key}=${stringifyValue(value)}`);
  const base = kv.length > 0 ? `${table}: ${kv.join(', ')}` : `${table}: record`;
  return base.length > 500 ? `${base.slice(0, 497)}...` : base;
}

function synthesizeProfileUpdateText(data: JsonObject): string {
  const kv = Object.entries(data).map(([key, value]) => `${key}=${stringifyValue(value)}`);
  const base = kv.length > 0 ? `Profile update: ${kv.join(', ')}` : 'Profile update';
  return base.length > 500 ? `${base.slice(0, 497)}...` : base;
}

export function isLegacyToolName(toolName: string): boolean {
  return LEGACY_TOOL_NAMES.has(toolName);
}

export function translateLegacyToolCall(
  toolName: string,
  args: Record<string, unknown>,
): LegacyToolTranslation | null {
  if (!isLegacyToolName(toolName)) {
    return null;
  }

  const safeArgs = isRecord(args) ? args : {};

  switch (toolName) {
    case 'get_user_context': {
      const topic = isNonEmptyString(safeArgs.topic) ? safeArgs.topic.trim() : undefined;
      return {
        toolName: 'recall',
        args: topic
          ? compactObject({
              mode: 'knowledge',
              topic,
              budget: safeArgs.budget,
            })
          : { mode: 'context' },
      };
    }

    case 'retrieve_user_knowledge': {
      if (!isNonEmptyString(safeArgs.topic)) return null;
      return {
        toolName: 'recall',
        args: compactObject({
          mode: 'knowledge',
          topic: safeArgs.topic,
          budget: safeArgs.budget,
        }),
      };
    }

    case 'list_tables': {
      return {
        toolName: 'recall',
        args: { mode: 'table' },
      };
    }

    case 'query_table': {
      const table = legacyTableName(safeArgs);
      if (!table) return null;
      return {
        toolName: 'recall',
        args: {
          mode: 'table',
          table: compactObject({
            table,
            filters: safeArgs.filters,
            sql: safeArgs.sql,
            limit: safeArgs.limit,
            offset: safeArgs.offset,
          }),
        },
      };
    }

    case 'search_memory': {
      if (!isNonEmptyString(safeArgs.collection) || !isNonEmptyString(safeArgs.query)) return null;
      return {
        toolName: 'recall',
        args: {
          mode: 'memory',
          memory: compactObject({
            collection: safeArgs.collection,
            query: safeArgs.query,
            minSimilarity: safeArgs.minSimilarity,
            limit: safeArgs.limit,
          }),
        },
      };
    }

    case 'query_graph': {
      if (!isNonEmptyString(safeArgs.queryType)) return null;
      return {
        toolName: 'recall',
        args: {
          mode: 'graph',
          graph: compactObject({
            queryType: safeArgs.queryType,
            entityId: safeArgs.entityId,
            relation: safeArgs.relation,
            maxHops: safeArgs.maxHops,
            pattern: safeArgs.pattern,
          }),
        },
      };
    }

    case 'add_record': {
      const table = legacyTableName(safeArgs);
      const data = safeArgs.data;
      if (!table || !isRecord(data)) return null;

      return {
        toolName: 'memorize',
        args: {
          text: synthesizeAddRecordText(table, data),
          category: table,
          data,
        },
      };
    }

    case 'save_memory': {
      if (!isNonEmptyString(safeArgs.collection) || !isNonEmptyString(safeArgs.text)) return null;
      return {
        toolName: 'memorize',
        args: compactObject({
          text: safeArgs.text,
          storage: 'memory',
          collection: safeArgs.collection,
          metadata: safeArgs.metadata,
        }),
      };
    }

    case 'update_profile': {
      const data = safeArgs.data;
      if (!isRecord(data) || Object.keys(data).length === 0) return null;

      const reason = isNonEmptyString(safeArgs.reason) ? safeArgs.reason : undefined;
      return {
        toolName: 'memorize',
        args: {
          text: reason || synthesizeProfileUpdateText(data),
          category: 'profile',
          data,
        },
      };
    }

    case 'review_memories': {
      if (!isNonEmptyString(safeArgs.action)) return null;
      return {
        toolName: 'review',
        args: compactObject({
          action: safeArgs.action,
          metaId: safeArgs.metaId,
          resolution: safeArgs.resolution,
        }),
      };
    }

    default:
      return null;
  }
}

function rewriteJsonRpcMessage(message: unknown, rewrites?: LegacyRewriteEvent[]): unknown {
  if (!isRecord(message)) return message;
  if (message.method !== 'tools/call') return message;
  if (!isRecord(message.params)) return message;

  const params = message.params;
  const name = params.name;
  if (typeof name !== 'string') return message;

  // MCP tools/call uses params.arguments; leave non-standard params.args untouched.
  if ('args' in params && !('arguments' in params)) return message;

  // MCP tools/call uses params.arguments, not params.args
  const args = isRecord(params.arguments) ? params.arguments : {};
  const translated = translateLegacyToolCall(name, args);
  if (!translated) return message;
  rewrites?.push({
    fromToolName: name,
    toToolName: translated.toolName,
  });

  return {
    ...message,
    params: {
      ...params,
      name: translated.toolName,
      arguments: translated.args,
    },
  };
}

export function rewriteLegacyJsonRpc(body: unknown): unknown {
  return rewriteLegacyJsonRpcWithEvents(body).body;
}

export function rewriteLegacyJsonRpcWithEvents(body: unknown): {
  body: unknown;
  rewrites: LegacyRewriteEvent[];
} {
  const rewrites: LegacyRewriteEvent[] = [];
  if (Array.isArray(body)) {
    return {
      body: body.map((message) => rewriteJsonRpcMessage(message, rewrites)),
      rewrites,
    };
  }
  return {
    body: rewriteJsonRpcMessage(body, rewrites),
    rewrites,
  };
}
