// api/tests/unit/services/tools/adapters.test.ts
import { describe, it, expect } from 'vitest';
import { mcpAdapter, chatgptAdapter } from '@/services/tools/adapters';
import { toolSuccess, toolFailure, ToolErrorCode } from '@/services/tools/types';

describe('mcpAdapter', () => {
  it('formats success as JSON.stringify in content text', () => {
    const result = toolSuccess({ tables: ['meals'] }, 'Found 1 table');
    const adapted = mcpAdapter(result);

    expect(adapted.content).toEqual([{ type: 'text', text: '{"tables":["meals"]}' }]);
    expect(adapted.isError).toBeUndefined();
  });

  it('formats failure with isError true and message as text', () => {
    const result = toolFailure(
      ToolErrorCode.CONSENT_DENIED,
      "CONSENT_DENIED: Agent 'test' does not have read access to tables/*",
    );
    const adapted = mcpAdapter(result);

    expect(adapted.content).toEqual([
      { type: 'text', text: "CONSENT_DENIED: Agent 'test' does not have read access to tables/*" },
    ]);
    expect(adapted.isError).toBe(true);
  });

  it('embeds meta in success payload when warnings are present', () => {
    const result = toolSuccess(
      { tables: ['meals'] },
      'Found 1 table',
      { warnings: ['No vectors read consent — collections section empty.'] },
    );
    const adapted = mcpAdapter(result);
    const payload = JSON.parse(adapted.content[0].text);

    expect(payload).toEqual({
      tables: ['meals'],
      _meta: { warnings: ['No vectors read consent — collections section empty.'] },
    });
  });
});

describe('chatgptAdapter', () => {
  it('returns structuredContent with data object (not stringified)', () => {
    const data = { tables: ['meals', 'workouts'] };
    const result = toolSuccess(data, 'Found 2 tables');
    const adapted = chatgptAdapter(result);

    expect(adapted.structuredContent).toEqual(data);
    expect(adapted.content).toEqual([{ type: 'text', text: 'Found 2 tables' }]);
    expect(adapted.isError).toBeUndefined();
  });

  it('formats failure with isError true and message as text', () => {
    const result = toolFailure(
      ToolErrorCode.INVALID_ARGS,
      'INVALID_ARGS: query_table requires "table" (or legacy "tableName").',
    );
    const adapted = chatgptAdapter(result);

    expect(adapted.content).toEqual([
      { type: 'text', text: 'INVALID_ARGS: query_table requires "table" (or legacy "tableName").' },
    ]);
    expect(adapted.isError).toBe(true);
    expect(adapted.structuredContent).toBeUndefined();
  });

  it('includes warnings in content and structuredContent meta', () => {
    const result = toolSuccess(
      { profile: { name: 'Bruce' } },
      'User context retrieved successfully.',
      { warnings: ['No graph read consent — topEntities section empty.'] },
    );
    const adapted = chatgptAdapter(result);

    expect(adapted.content[0].text).toContain('Warnings: No graph read consent — topEntities section empty.');
    expect(adapted.structuredContent).toEqual({
      profile: { name: 'Bruce' },
      _meta: { warnings: ['No graph read consent — topEntities section empty.'] },
    });
  });
});
