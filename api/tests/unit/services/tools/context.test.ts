// api/tests/unit/services/tools/context.test.ts
import { describe, it, expect } from 'vitest';
import { buildToolContext } from '@/services/tools/context';

describe('buildToolContext', () => {
  it('builds context from MCP authInfo extra', () => {
    const ctx = buildToolContext({
      userId: 'user-123',
      agentId: 'claude-desktop',
      tier: 'pro',
      authType: 'api_key',
    });

    expect(ctx.userId).toBe('user-123');
    expect(ctx.agentId).toBe('claude-desktop');
    expect(ctx.tier).toBe('pro');
    expect(ctx.authType).toBe('api_key');
    expect(ctx.schemaName).toBe('user_user123');
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('throws on missing userId', () => {
    expect(() =>
      buildToolContext({ userId: '', agentId: 'test', tier: 'free', authType: 'api_key' }),
    ).toThrow('UNAUTHORIZED');
  });

  it('defaults tier to free when unrecognized', () => {
    const ctx = buildToolContext({
      userId: 'user-123',
      agentId: 'test',
      tier: 'unknown' as any,
      authType: 'api_key',
    });
    expect(ctx.tier).toBe('free');
  });

  it('accepts optional requestId override', () => {
    const ctx = buildToolContext({
      userId: 'user-123',
      agentId: 'test',
      tier: 'free',
      authType: 'api_key',
      requestId: 'custom-req-id',
    });
    expect(ctx.requestId).toBe('custom-req-id');
  });
});
