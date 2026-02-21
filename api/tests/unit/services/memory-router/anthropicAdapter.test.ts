import { describe, it, expect } from 'vitest';
import { anthropicAdapter } from '@/services/memory-router/providers/anthropic';

describe('anthropicAdapter', () => {
  it('extracts the latest user query from messages', () => {
    const query = anthropicAdapter.extractUserQuery({
      model: 'claude-3-5-sonnet-latest',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] },
      ],
    });

    expect(query).toBe('latest question');
  });

  it('injects context into existing system string', () => {
    const payload = anthropicAdapter.injectMemoryContext(
      {
        model: 'claude-3-5-sonnet-latest',
        system: 'Follow policy',
        messages: [{ role: 'user', content: 'hello' }],
      },
      'MEMORY CONTEXT',
    );

    expect(payload.system).toBe('MEMORY CONTEXT\n\nFollow policy');
  });

  it('creates system context when none exists', () => {
    const payload = anthropicAdapter.injectMemoryContext(
      {
        model: 'claude-3-5-sonnet-latest',
        messages: [{ role: 'user', content: 'hello' }],
      },
      'MEMORY CONTEXT',
    );

    expect(payload.system).toBe('MEMORY CONTEXT');
  });

  it('extracts assistant text from non-stream JSON payload', () => {
    const text = anthropicAdapter.extractAssistantTextFromJson({
      id: 'msg_1',
      type: 'message',
      content: [
        { type: 'text', text: 'I remember your coffee preference.' },
      ],
    });

    expect(text).toBe('I remember your coffee preference.');
  });

  it('extracts assistant text from stream content_block_delta event', () => {
    const text = anthropicAdapter.extractAssistantTextFromStreamEvent({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'partial chunk' },
    });

    expect(text).toBe('partial chunk');
  });
});
