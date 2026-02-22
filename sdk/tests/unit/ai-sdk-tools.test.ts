import { describe, expect, it, vi } from 'vitest';
import type { EpitomeClient } from '../../src/client.js';
import { epitomeTools } from '../../src/ai-sdk/index.js';

describe('epitomeTools', () => {
  it('requires either client or apiKey', () => {
    expect(() => epitomeTools({})).toThrow(
      'epitomeTools requires either an existing client or an apiKey',
    );
  });

  it('returns tool definitions for searchMemory/saveMemory/getUserContext', () => {
    const fakeClient = {
      searchMemory: vi.fn(),
      saveMemory: vi.fn(),
      getUserContext: vi.fn(),
    } as unknown as EpitomeClient;

    const tools = epitomeTools({ client: fakeClient });

    expect(tools).toHaveProperty('searchMemory');
    expect(tools).toHaveProperty('saveMemory');
    expect(tools).toHaveProperty('getUserContext');
  });

  it('executes searchMemory tool with configured default collection', async () => {
    const searchMemory = vi.fn().mockResolvedValue({
      results: [],
      total: 0,
      query: 'project',
      minSimilarity: 0.7,
    });
    const fakeClient = {
      searchMemory,
      saveMemory: vi.fn(),
      getUserContext: vi.fn(),
    } as unknown as EpitomeClient;

    const tools = epitomeTools({
      client: fakeClient,
      collectionDefaults: { searchMemory: 'journal' },
    });

    const result = await (tools.searchMemory as any).execute({
      query: 'project',
    });

    expect(searchMemory).toHaveBeenCalledWith({
      query: 'project',
      collection: 'journal',
      limit: undefined,
      minSimilarity: undefined,
    });
    expect(result.total).toBe(0);
  });

  it('executes saveMemory and getUserContext tools', async () => {
    const saveMemory = vi.fn().mockResolvedValue({
      id: 1,
      pendingId: null,
      collection: 'memories',
      sourceRef: 'vectors:1',
      writeId: 'w_1',
      writeStatus: 'active',
      jobId: null,
    });
    const getUserContext = vi.fn().mockResolvedValue({
      profile: {},
      tables: [],
      collections: [],
      topEntities: [],
      recentMemories: [],
      hints: {
        hasStructuredData: false,
        hasMemories: false,
        hasGraphData: false,
        suggestedTools: [],
      },
    });

    const fakeClient = {
      searchMemory: vi.fn(),
      saveMemory,
      getUserContext,
    } as unknown as EpitomeClient;

    const tools = epitomeTools({
      client: fakeClient,
      collectionDefaults: { saveMemory: 'journal' },
    });

    await (tools.saveMemory as any).execute({
      text: 'remember this',
      metadata: { source: 'unit-test' },
    });
    await (tools.getUserContext as any).execute({ topic: 'preferences' });

    expect(saveMemory).toHaveBeenCalledWith({
      text: 'remember this',
      collection: 'journal',
      metadata: { source: 'unit-test' },
    });
    expect(getUserContext).toHaveBeenCalledWith({ topic: 'preferences' });
  });
});
