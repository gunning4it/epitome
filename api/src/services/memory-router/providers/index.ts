import type { MemoryRouterProvider, ProviderAdapter } from '@/services/memory-router/types';
import { openAiAdapter } from '@/services/memory-router/providers/openai';
import { anthropicAdapter } from '@/services/memory-router/providers/anthropic';

const ADAPTERS: Record<MemoryRouterProvider, ProviderAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
};

export function getProviderAdapter(provider: MemoryRouterProvider): ProviderAdapter {
  return ADAPTERS[provider];
}
