import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';

function createSseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

describe('Memory Router Streaming Integration', () => {
  let testUser: TestUser;
  const savedFetch = global.fetch;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    const enableResponse = await app.request('/v1/memory-router/settings', {
      method: 'PATCH',
      headers: createTestSessionHeaders(testUser),
      body: JSON.stringify({ body: { enabled: true } }),
    });
    expect(enableResponse.status).toBe(200);
  });

  afterEach(async () => {
    global.fetch = savedFetch;
    await cleanupTestUser(testUser.userId);
  });

  it('passes through non-stream provider response shape and status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl_123',
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');
    headers.set('x-epitome-memory-mode', 'off');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.id).toBe('chatcmpl_123');
    expect(body.choices[0].message.content).toBe('hello');
  });

  it('passes through SSE streaming responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');
    headers.set('x-epitome-memory-mode', 'off');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('data: {"choices":[{"delta":{"content":"Hello"}}]}');
    expect(text).toContain('data: [DONE]');
  });

  it('passes through Anthropic non-stream provider response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          type: 'message',
          content: [{ type: 'text', text: 'anthropic response' }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('x-anthropic-api-key', 'sk-ant-test');
    headers.set('x-epitome-memory-mode', 'off');

    const response = await app.request('/v1/memory-router/anthropic/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.id).toBe('msg_123');
    expect(body.content[0].text).toBe('anthropic response');
  });

  it('passes through Anthropic SSE streaming responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
      ]),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('x-anthropic-api-key', 'sk-ant-test');
    headers.set('x-epitome-memory-mode', 'off');

    const response = await app.request('/v1/memory-router/anthropic/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        stream: true,
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('content_block_delta');
  });

  it('passes through upstream 4xx/5xx status and body', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'rate limit' },
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');
    headers.set('x-epitome-memory-mode', 'off');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(429);
    const body = await response.json() as any;
    expect(body.error.message).toBe('rate limit');
  });
});
