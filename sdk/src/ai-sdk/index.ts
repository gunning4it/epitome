import { tool } from 'ai';
import { EpitomeClient } from '../client.js';
import {
  getUserContextToolInputSchema,
  saveMemoryToolInputSchema,
  searchMemoryToolInputSchema,
} from './schemas.js';
import type { EpitomeToolsOptions } from './types.js';

export { type EpitomeToolsOptions } from './types.js';
export {
  type GetUserContextToolOutput,
  type GetUserContextToolInput,
  type SaveMemoryToolOutput,
  type SaveMemoryToolInput,
  type SearchMemoryToolOutput,
  type SearchMemoryToolInput,
} from './schemas.js';

export function epitomeTools(options: EpitomeToolsOptions) {
  const client = resolveClient(options);
  const searchDefaultCollection = options.collectionDefaults?.searchMemory;
  const saveDefaultCollection = options.collectionDefaults?.saveMemory;

  return {
    searchMemory: tool({
      description:
        'Search the user memory store for semantically similar entries.',
      inputSchema: searchMemoryToolInputSchema,
      execute: async (input) => {
        return client.searchMemory({
          query: input.query,
          collection: input.collection ?? searchDefaultCollection,
          limit: input.limit,
          minSimilarity: input.minSimilarity,
        });
      },
    }),
    saveMemory: tool({
      description: 'Persist a new memory entry for later semantic recall.',
      inputSchema: saveMemoryToolInputSchema,
      execute: async (input) => {
        return client.saveMemory({
          text: input.text,
          collection: input.collection ?? saveDefaultCollection,
          metadata: input.metadata,
        });
      },
    }),
    getUserContext: tool({
      description:
        'Load a structured context snapshot (profile, tables, entities, and recent memories).',
      inputSchema: getUserContextToolInputSchema,
      execute: async (input) => {
        return client.getUserContext({
          topic: input.topic,
        });
      },
    }),
  };
}

function resolveClient(options: EpitomeToolsOptions): EpitomeClient {
  if (options.client) {
    return options.client;
  }

  if (!options.apiKey) {
    throw new Error(
      'epitomeTools requires either an existing client or an apiKey',
    );
  }

  return new EpitomeClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    defaultCollection: options.defaultCollection,
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
  });
}
