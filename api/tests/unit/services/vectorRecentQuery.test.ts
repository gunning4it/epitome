import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/client', () => ({
  withUserSchema: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { withUserSchema } from '@/db/client';
import { listRecentVectors } from '@/services/vector.service';

const withUserSchemaMock = vi.mocked(withUserSchema);

describe('listRecentVectors SQL query safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('casts LIMIT/OFFSET params to int when no collection filter is set', async () => {
    const unsafe = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    withUserSchemaMock.mockImplementation(async (_userId, callback) => callback({ unsafe } as any));

    await listRecentVectors('u1');

    const mainQuery = unsafe.mock.calls[0][0] as string;
    expect(mainQuery).toContain('LIMIT $1::int OFFSET $2::int');
    expect(unsafe.mock.calls[0][1]).toEqual([50, 0]);
  });

  it('uses correctly typed collection placeholders for main and count queries', async () => {
    const unsafe = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    withUserSchemaMock.mockImplementation(async (_userId, callback) => callback({ unsafe } as any));

    await listRecentVectors('u1', { collection: 'journal', limit: 20, offset: 10 });

    const mainQuery = unsafe.mock.calls[0][0] as string;
    const countQuery = unsafe.mock.calls[1][0] as string;

    expect(mainQuery).toContain('v.collection = $3::text');
    expect(mainQuery).toContain('LIMIT $1::int OFFSET $2::int');
    expect(unsafe.mock.calls[0][1]).toEqual([20, 10, 'journal']);

    expect(countQuery).toContain('v.collection = $1::text');
    expect(unsafe.mock.calls[1][1]).toEqual(['journal']);
  });
});
