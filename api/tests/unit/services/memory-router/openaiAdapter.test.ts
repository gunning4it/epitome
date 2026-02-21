import { describe, it, expect } from 'vitest';
import { openAiAdapter } from '@/services/memory-router/providers/openai';

describe('openAiAdapter', () => {
  it('extracts the latest user query from messages', () => {
    const query = openAiAdapter.extractUserQuery({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'latest question' },
      ],
    });

    expect(query).toBe('latest question');
  });

  it('injects context into an existing system message', () => {
    const payload = openAiAdapter.injectMemoryContext(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Original policy' },
          { role: 'user', content: 'hello' },
        ],
      },
      'MEMORY CONTEXT',
    );

    const messages = payload.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('MEMORY CONTEXT\n\nOriginal policy');
  });

  it('creates a new system message when one does not exist', () => {
    const payload = openAiAdapter.injectMemoryContext(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      },
      'MEMORY CONTEXT',
    );

    const messages = payload.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('MEMORY CONTEXT');
  });

  it('extracts assistant text from non-stream JSON payload', () => {
    const text = openAiAdapter.extractAssistantTextFromJson({
      id: 'chatcmpl_1',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I remember you like matcha.',
          },
        },
      ],
    });

    expect(text).toBe('I remember you like matcha.');
  });

  it('extracts assistant text from stream delta event', () => {
    const text = openAiAdapter.extractAssistantTextFromStreamEvent({
      choices: [
        {
          delta: {
            content: 'partial chunk',
          },
        },
      ],
    });

    expect(text).toBe('partial chunk');
  });
});
