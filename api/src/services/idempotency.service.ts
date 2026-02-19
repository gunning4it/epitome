// api/src/services/idempotency.service.ts

import { createHash, randomUUID } from 'node:crypto';
import { sql } from '@/db/client';
import { logger } from '@/utils/logger';

/**
 * Deep recursive key-sort for canonical serialization.
 * Arrays preserve order, objects get sorted keys.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      },
      {} as Record<string, unknown>,
    );
}

/**
 * SHA-256 hash of canonicalized JSON.
 */
export function computeRequestHash(args: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(args)))
    .digest('hex');
}

const STALE_RESERVATION_MS = 30_000; // 30 seconds
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5_000;

interface LedgerRow {
  request_hash: string;
  status: string;
  response: unknown;
  reserved_at: Date;
  owner_token: string;
}

/**
 * Execute a tool function with at-most-once idempotency guarantees.
 *
 * Uses a reserve-then-execute pattern with CAS owner tokens:
 * 1. Attempt INSERT with owner_token → if succeeds, this worker owns execution
 * 2. Execute tool, then CAS-complete with owner_token
 * 3. On conflict: check hash match, return cached response or poll for completion
 */
export async function executeWithIdempotency<T>(
  userId: string,
  toolName: string,
  idempotencyKey: string,
  args: unknown,
  executeFn: () => Promise<T>,
): Promise<{ result: T; cached: boolean }> {
  const requestHash = computeRequestHash(args);
  const ownerToken = randomUUID();

  // Step 1: Attempt reservation
  const inserted = await sql`
    INSERT INTO public.idempotency_ledger (user_id, tool_name, idempotency_key, request_hash, status, owner_token)
    VALUES (${userId}, ${toolName}, ${idempotencyKey}, ${requestHash}, 'reserved', ${ownerToken})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;

  if (inserted.length > 0) {
    // This worker owns execution
    return await executeAndComplete<T>(userId, toolName, idempotencyKey, ownerToken, executeFn);
  }

  // Step 3: Conflict — check existing row
  return await handleConflict<T>(userId, toolName, idempotencyKey, requestHash, args, executeFn);
}

async function executeAndComplete<T>(
  userId: string,
  toolName: string,
  idempotencyKey: string,
  ownerToken: string,
  executeFn: () => Promise<T>,
): Promise<{ result: T; cached: boolean }> {
  let result: T;
  try {
    result = await executeFn();
  } catch (err) {
    // On execution failure, clean up the reservation so a retry can succeed
    await sql`
      DELETE FROM public.idempotency_ledger
      WHERE user_id = ${userId}
        AND tool_name = ${toolName}
        AND idempotency_key = ${idempotencyKey}
        AND owner_token = ${ownerToken}
        AND status = 'reserved'
    `;
    throw err;
  }

  // CAS completion: only the owning worker can complete
  const updated = await sql`
    UPDATE public.idempotency_ledger
    SET status = 'completed',
        response = ${JSON.stringify(result)}::jsonb,
        completed_at = NOW()
    WHERE user_id = ${userId}
      AND tool_name = ${toolName}
      AND idempotency_key = ${idempotencyKey}
      AND owner_token = ${ownerToken}
      AND status = 'reserved'
  `;

  if (updated.count === 0) {
    // Reservation was reclaimed while we were executing — discard result
    logger.warn('Idempotency: reservation reclaimed during execution', {
      userId,
      toolName,
      idempotencyKey,
    });
  }

  return { result, cached: false };
}

async function handleConflict<T>(
  userId: string,
  toolName: string,
  idempotencyKey: string,
  requestHash: string,
  args: unknown,
  executeFn: () => Promise<T>,
  retryCount = 0,
): Promise<{ result: T; cached: boolean }> {
  const rows = await sql<LedgerRow[]>`
    SELECT request_hash, status, response, reserved_at, owner_token
    FROM public.idempotency_ledger
    WHERE user_id = ${userId}
      AND tool_name = ${toolName}
      AND idempotency_key = ${idempotencyKey}
  `;

  if (rows.length === 0) {
    // Row was deleted (cleanup or reclaim) — retry once
    if (retryCount > 0) {
      throw new Error('Idempotency ledger: unable to reserve after reclaim');
    }
    return executeWithIdempotency(userId, toolName, idempotencyKey, args, executeFn) as Promise<{
      result: T;
      cached: boolean;
    }>;
  }

  const existing = rows[0];

  // Hash mismatch — different payload for same key
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyHashMismatchError(
      'Idempotency key already used with different arguments',
    );
  }

  // Completed — return cached response
  if (existing.status === 'completed') {
    return { result: existing.response as T, cached: true };
  }

  // Reserved and stale — attempt reclaim
  const reservedAt = existing.reserved_at instanceof Date
    ? existing.reserved_at.getTime()
    : new Date(existing.reserved_at).getTime();

  if (Date.now() - reservedAt > STALE_RESERVATION_MS) {
    // CAS delete: only one reclaimer wins
    const deleted = await sql`
      DELETE FROM public.idempotency_ledger
      WHERE user_id = ${userId}
        AND tool_name = ${toolName}
        AND idempotency_key = ${idempotencyKey}
        AND owner_token = ${existing.owner_token}
        AND status = 'reserved'
    `;

    if (deleted.count > 0) {
      // We won the reclaim — re-enter at step 1
      if (retryCount > 0) {
        throw new Error('Idempotency ledger: unable to reserve after reclaim');
      }
      return executeWithIdempotency(userId, toolName, idempotencyKey, args, executeFn) as Promise<{
        result: T;
        cached: boolean;
      }>;
    }
    // Another reclaimer won — fall through to poll
  }

  // Reserved and fresh — poll for completion
  return await pollForCompletion<T>(userId, toolName, idempotencyKey);
}

async function pollForCompletion<T>(
  userId: string,
  toolName: string,
  idempotencyKey: string,
): Promise<{ result: T; cached: boolean }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const rows = await sql<Pick<LedgerRow, 'status' | 'response'>[]>`
      SELECT status, response
      FROM public.idempotency_ledger
      WHERE user_id = ${userId}
        AND tool_name = ${toolName}
        AND idempotency_key = ${idempotencyKey}
    `;

    if (rows.length === 0) {
      throw new Error('Idempotency ledger: entry disappeared during polling');
    }

    if (rows[0].status === 'completed') {
      return { result: rows[0].response as T, cached: true };
    }
  }

  throw new IdempotencyTimeoutError('Idempotency: timed out waiting for completion');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Background cleanup: delete completed rows >24h old and stale reservations >5min old.
 * Called at app startup and on an hourly interval.
 */
export async function cleanupIdempotencyLedger(): Promise<void> {
  try {
    const completedResult = await sql`
      DELETE FROM public.idempotency_ledger
      WHERE status = 'completed'
        AND completed_at < NOW() - INTERVAL '24 hours'
    `;

    const reservedResult = await sql`
      DELETE FROM public.idempotency_ledger
      WHERE status = 'reserved'
        AND reserved_at < NOW() - INTERVAL '5 minutes'
    `;

    const completedCount = completedResult.count;
    const reservedCount = reservedResult.count;

    if (completedCount > 0 || reservedCount > 0) {
      logger.info('Idempotency cleanup', {
        completedDeleted: completedCount,
        staleReservedDeleted: reservedCount,
      });
    }
  } catch (err) {
    logger.error('Idempotency cleanup failed', { error: String(err) });
  }
}

/**
 * Error thrown when an idempotency key is reused with a different payload.
 */
export class IdempotencyHashMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyHashMismatchError';
  }
}

/**
 * Error thrown when polling for a concurrent reservation times out.
 */
export class IdempotencyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyTimeoutError';
  }
}
