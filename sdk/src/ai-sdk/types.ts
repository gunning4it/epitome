import type { EpitomeClient } from '../client.js';

export interface EpitomeToolsCollectionDefaults {
  searchMemory?: string;
  saveMemory?: string;
}

export interface EpitomeToolsOptions {
  client?: EpitomeClient;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  defaultCollection?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  collectionDefaults?: EpitomeToolsCollectionDefaults;
}
