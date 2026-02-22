import { describe, it, expect } from 'vitest';
import { rewriteLegacyJsonRpc, translateLegacyToolCall } from '@/mcp/legacyTranslator';

describe('translateLegacyToolCall', () => {
  it('translates get_user_context with topic to recall knowledge mode', () => {
    const translated = translateLegacyToolCall('get_user_context', { topic: 'food' });
    expect(translated).toEqual({
      toolName: 'recall',
      args: { mode: 'knowledge', topic: 'food' },
    });
  });

  it('translates get_user_context without topic to recall context mode', () => {
    const translated = translateLegacyToolCall('get_user_context', {});
    expect(translated).toEqual({
      toolName: 'recall',
      args: { mode: 'context' },
    });
  });

  it('translates retrieve_user_knowledge to recall knowledge mode', () => {
    const translated = translateLegacyToolCall('retrieve_user_knowledge', {
      topic: 'books',
      budget: 'deep',
    });
    expect(translated).toEqual({
      toolName: 'recall',
      args: { mode: 'knowledge', topic: 'books', budget: 'deep' },
    });
  });

  it('translates list_tables to recall table mode', () => {
    const translated = translateLegacyToolCall('list_tables', {});
    expect(translated).toEqual({
      toolName: 'recall',
      args: { mode: 'table' },
    });
  });

  it('translates query_table with tableName alias', () => {
    const translated = translateLegacyToolCall('query_table', {
      tableName: 'books',
      filters: { status: 'finished' },
      limit: 10,
    });
    expect(translated).toEqual({
      toolName: 'recall',
      args: {
        mode: 'table',
        table: {
          table: 'books',
          filters: { status: 'finished' },
          limit: 10,
        },
      },
    });
  });

  it('translates search_memory to recall memory mode', () => {
    const translated = translateLegacyToolCall('search_memory', {
      collection: 'journal',
      query: 'coffee',
      minSimilarity: 0.8,
      limit: 3,
    });
    expect(translated).toEqual({
      toolName: 'recall',
      args: {
        mode: 'memory',
        memory: {
          collection: 'journal',
          query: 'coffee',
          minSimilarity: 0.8,
          limit: 3,
        },
      },
    });
  });

  it('translates query_graph to recall graph mode', () => {
    const translated = translateLegacyToolCall('query_graph', {
      queryType: 'pattern',
      pattern: { relation: 'likes' },
    });
    expect(translated).toEqual({
      toolName: 'recall',
      args: {
        mode: 'graph',
        graph: {
          queryType: 'pattern',
          pattern: { relation: 'likes' },
        },
      },
    });
  });

  it('translates add_record to memorize with synthesized text', () => {
    const translated = translateLegacyToolCall('add_record', {
      table: 'books',
      data: { title: 'Dune', rating: 5 },
    });

    expect(translated).not.toBeNull();
    expect(translated?.toolName).toBe('memorize');
    expect(translated?.args.category).toBe('books');
    expect(translated?.args.data).toEqual({ title: 'Dune', rating: 5 });
    expect(String(translated?.args.text)).toContain('books:');
    expect(String(translated?.args.text)).toContain('title=Dune');
  });

  it('translates save_memory to memorize memory storage', () => {
    const translated = translateLegacyToolCall('save_memory', {
      collection: 'journal',
      text: 'Had coffee today',
      metadata: { mood: 'good' },
    });
    expect(translated).toEqual({
      toolName: 'memorize',
      args: {
        text: 'Had coffee today',
        storage: 'memory',
        collection: 'journal',
        metadata: { mood: 'good' },
      },
    });
  });

  it('translates update_profile to memorize profile category', () => {
    const translated = translateLegacyToolCall('update_profile', {
      data: { timezone: 'America/Los_Angeles' },
      reason: 'User moved to west coast',
    });
    expect(translated).toEqual({
      toolName: 'memorize',
      args: {
        text: 'User moved to west coast',
        category: 'profile',
        data: { timezone: 'America/Los_Angeles' },
      },
    });
  });

  it('translates review_memories to review passthrough', () => {
    const translated = translateLegacyToolCall('review_memories', {
      action: 'resolve',
      metaId: 1,
      resolution: 'confirm',
    });
    expect(translated).toEqual({
      toolName: 'review',
      args: { action: 'resolve', metaId: 1, resolution: 'confirm' },
    });
  });

  it('returns null for non-legacy tool names', () => {
    expect(translateLegacyToolCall('recall', {})).toBeNull();
  });

  it('guards add_record when required fields are missing', () => {
    expect(translateLegacyToolCall('add_record', {})).toBeNull();
  });

  it('guards save_memory when collection is missing', () => {
    expect(translateLegacyToolCall('save_memory', { text: 'hello' })).toBeNull();
  });

  it('guards update_profile when data is missing or empty', () => {
    expect(translateLegacyToolCall('update_profile', {})).toBeNull();
    expect(translateLegacyToolCall('update_profile', { data: {} })).toBeNull();
  });
});

describe('rewriteLegacyJsonRpc', () => {
  it('rewrites single tools/call request using params.arguments', () => {
    const input = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_tables',
        arguments: {},
      },
    };

    const output = rewriteLegacyJsonRpc(input) as any;

    expect(output.params.name).toBe('recall');
    expect(output.params.arguments).toEqual({ mode: 'table' });
  });

  it('does not rewrite when using params.args (non-MCP shape)', () => {
    const input = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_tables',
        args: {},
      },
    };

    const output = rewriteLegacyJsonRpc(input);
    expect(output).toEqual(input);
  });

  it('handles batch requests and rewrites only matching messages', () => {
    const batch = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_user_context', arguments: { topic: 'food' } },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'recall', arguments: {} },
      },
    ];

    const output = rewriteLegacyJsonRpc(batch) as any[];

    expect(output[0].params.name).toBe('recall');
    expect(output[0].params.arguments).toEqual({ mode: 'knowledge', topic: 'food' });
    expect(output[1]).toEqual(batch[1]);
    expect(output[2]).toEqual(batch[2]);
  });

  it('passes through non-tools/call requests unchanged', () => {
    const input = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    };
    expect(rewriteLegacyJsonRpc(input)).toEqual(input);
  });

  it('passes through non-object bodies unchanged', () => {
    expect(rewriteLegacyJsonRpc('hello')).toBe('hello');
    expect(rewriteLegacyJsonRpc(42)).toBe(42);
    expect(rewriteLegacyJsonRpc(null)).toBeNull();
  });
});
