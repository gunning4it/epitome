import type { ProviderAdapter } from '@/services/memory-router/types';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
    if (typeof block.text === 'string' && !block.type) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

function clonePayload<T>(value: T): T {
  return structuredClone(value);
}

export const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',

  extractUserQuery(requestBody: Record<string, unknown>): string | null {
    const messages = requestBody.messages;
    if (!Array.isArray(messages)) return null;

    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const message = messages[idx];
      if (!message || typeof message !== 'object') continue;
      const msg = message as Record<string, unknown>;
      if (msg.role !== 'user') continue;

      const text = contentToText(msg.content);
      if (text) return text;
    }
    return null;
  },

  injectMemoryContext(
    requestBody: Record<string, unknown>,
    contextPreamble: string,
  ): Record<string, unknown> {
    const payload = clonePayload(requestBody);
    const existingSystem = payload.system;

    if (typeof existingSystem === 'string') {
      payload.system = `${contextPreamble}\n\n${existingSystem}`.trim();
      return payload;
    }

    if (Array.isArray(existingSystem)) {
      payload.system = [{ type: 'text', text: contextPreamble }, ...existingSystem];
      return payload;
    }

    payload.system = contextPreamble;
    return payload;
  },

  extractAssistantTextFromJson(responseBody: unknown): string {
    if (!responseBody || typeof responseBody !== 'object') return '';
    const body = responseBody as Record<string, unknown>;
    return contentToText(body.content);
  },

  extractAssistantTextFromStreamEvent(eventData: unknown): string {
    if (!eventData || typeof eventData !== 'object') return '';
    const event = eventData as Record<string, unknown>;

    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta && typeof delta === 'object') {
        const text = (delta as Record<string, unknown>).text;
        if (typeof text === 'string') return text;
      }
    }

    if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block && typeof block === 'object') {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === 'string') return text;
      }
    }

    return '';
  },
};
