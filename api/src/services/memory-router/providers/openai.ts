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
  }
  return parts.join('\n').trim();
}

function clonePayload<T>(value: T): T {
  return structuredClone(value);
}

export const openAiAdapter: ProviderAdapter = {
  provider: 'openai',

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
    const rawMessages = payload.messages;
    const messages = Array.isArray(rawMessages) ? rawMessages : [];

    const systemMessage = messages.find(
      (message) => message && typeof message === 'object' && (message as Record<string, unknown>).role === 'system',
    ) as Record<string, unknown> | undefined;

    if (systemMessage) {
      const existingContent = systemMessage.content;
      if (typeof existingContent === 'string') {
        systemMessage.content = `${contextPreamble}\n\n${existingContent}`.trim();
      } else if (Array.isArray(existingContent)) {
        systemMessage.content = [
          { type: 'text', text: contextPreamble },
          ...existingContent,
        ];
      } else {
        systemMessage.content = contextPreamble;
      }
    } else {
      messages.unshift({
        role: 'system',
        content: contextPreamble,
      });
    }

    payload.messages = messages;
    return payload;
  },

  extractAssistantTextFromJson(responseBody: unknown): string {
    if (!responseBody || typeof responseBody !== 'object') return '';
    const body = responseBody as Record<string, unknown>;
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) return '';

    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== 'object') return '';
    const choice = firstChoice as Record<string, unknown>;
    const message = choice.message;
    if (!message || typeof message !== 'object') return '';

    const content = (message as Record<string, unknown>).content;
    return contentToText(content);
  },

  extractAssistantTextFromStreamEvent(eventData: unknown): string {
    if (!eventData || typeof eventData !== 'object') return '';
    const event = eventData as Record<string, unknown>;
    const choices = event.choices;
    if (!Array.isArray(choices) || choices.length === 0) return '';

    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== 'object') return '';
    const choice = firstChoice as Record<string, unknown>;
    const delta = choice.delta;
    if (!delta || typeof delta !== 'object') return '';

    const content = (delta as Record<string, unknown>).content;
    return contentToText(content);
  },
};
