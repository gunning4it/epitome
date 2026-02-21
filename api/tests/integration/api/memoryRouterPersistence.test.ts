import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '@/index';
import { createTestUser, cleanupTestUser, type TestUser } from '../../helpers/db';
import { createTestAuthHeaders, createTestSessionHeaders } from '../../helpers/app';
import { resetAllRateLimits } from '@/services/rateLimit.service';
import { grantConsent } from '@/services/consent.service';
import * as saveMemoryModule from '@/services/tools/saveMemory';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Memory Router Persistence Integration', () => {
  let testUser: TestUser;
  const savedFetch = global.fetch;

  beforeEach(async () => {
    await resetAllRateLimits();
    testUser = await createTestUser();

    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'profile',
      permission: 'read',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors',
      permission: 'write',
    });
    await grantConsent(testUser.userId, {
      agentId: 'test-agent',
      resource: 'vectors/*',
      permission: 'write',
    });

    const enableResponse = await app.request('/v1/memory-router/settings', {
      method: 'PATCH',
      headers: createTestSessionHeaders(testUser),
      body: JSON.stringify({ body: { enabled: true } }),
    });
    expect(enableResponse.status).toBe(200);
  });

  afterEach(async () => {
    global.fetch = savedFetch;
    vi.restoreAllMocks();
    await cleanupTestUser(testUser.userId);
  });

  it('triggers saveMemory for non-stream responses', async () => {
    const saveSpy = vi.spyOn(saveMemoryModule, 'saveMemory').mockResolvedValue({
      success: true,
      message: 'ok',
      data: {},
    } as any);

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Here is the answer.' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');

    const response = await app.request('/v1/memory-router/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'What do you know about me?' }],
      }),
    });

    expect(response.status).toBe(200);
    await sleep(20);
    expect(saveSpy).toHaveBeenCalled();
  });

  it('triggers saveMemory after streaming completion', async () => {
    const saveSpy = vi.spyOn(saveMemoryModule, 'saveMemory').mockResolvedValue({
      success: true,
      message: 'ok',
      data: {},
    } as any);

    const encoder = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');

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
    await response.text();
    await sleep(40);
    expect(saveSpy).toHaveBeenCalled();
  });

  it('returns provider response even when saveMemory fails', async () => {
    vi.spyOn(saveMemoryModule, 'saveMemory').mockRejectedValue(new Error('save failed'));

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Response still returns.' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('authorization', 'Bearer sk-test-openai');

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
    expect(body.choices[0].message.content).toBe('Response still returns.');
  });

  it('triggers saveMemory for Anthropic responses', async () => {
    const saveSpy = vi.spyOn(saveMemoryModule, 'saveMemory').mockResolvedValue({
      success: true,
      message: 'ok',
      data: {},
    } as any);

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          type: 'message',
          content: [{ type: 'text', text: 'Anthropic answer' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as any;

    const headers = createTestAuthHeaders(testUser);
    headers.set('x-anthropic-api-key', 'sk-ant-test');

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
    await sleep(20);
    expect(saveSpy).toHaveBeenCalled();
  });
});
