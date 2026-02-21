export type MemoryRouterProvider = 'openai' | 'anthropic';
export type MemoryMode = 'auto' | 'off';

export interface MemoryRouterControlHeaders {
  mode: MemoryMode;
  collection: string;
  idempotencyKey?: string;
}

export interface MemoryRouterSettings {
  enabled: boolean;
  defaultCollection: string;
}

export interface ProviderAdapter {
  provider: MemoryRouterProvider;
  extractUserQuery(requestBody: Record<string, unknown>): string | null;
  injectMemoryContext(
    requestBody: Record<string, unknown>,
    contextPreamble: string,
  ): Record<string, unknown>;
  extractAssistantTextFromJson(responseBody: unknown): string;
  extractAssistantTextFromStreamEvent(eventData: unknown): string;
}
