// api/tests/parity/listTables.parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestUser, cleanupTestUser, type TestUser } from '../helpers/db';
import { grantConsent } from '@/services/consent.service';

// Legacy handler
import { listTables as legacyListTables } from '@/mcp/tools/listTables';
import type { McpContext } from '@/mcp/server';

// New service + adapter
import { listTables as listTablesService } from '@/services/tools/listTables';
import { mcpAdapter } from '@/services/tools/adapters';
import { buildToolContext } from '@/services/tools/context';

describe('listTables parity: legacy vs service+adapter', () => {
  let testUser: TestUser;
  let legacyCtx: McpContext;

  beforeEach(async () => {
    testUser = await createTestUser();
    legacyCtx = {
      userId: testUser.userId,
      agentId: 'parity-agent',
      tier: 'pro',
    };
    await grantConsent(testUser.userId, {
      agentId: 'parity-agent',
      resource: 'tables/*',
      permission: 'read',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('produces identical success output', async () => {
    const legacyResult = await legacyListTables({}, legacyCtx);

    const serviceCtx = buildToolContext({
      userId: testUser.userId,
      agentId: 'parity-agent',
      tier: 'pro',
      authType: 'api_key',
    });
    const serviceResult = await listTablesService({}, serviceCtx);
    const adapted = mcpAdapter(serviceResult);

    // Compare parsed structures — JSON.parse normalizes Date→string
    expect(JSON.parse(adapted.content[0].text)).toEqual(legacyResult);
    expect(adapted.isError).toBeUndefined();
  });
});
