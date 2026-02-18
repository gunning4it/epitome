/**
 * Tier Limit Error
 *
 * Thrown when a user exceeds their tier's resource limits.
 * Caught by onError handler in index.ts → returns 402.
 */

export class TierLimitError extends Error {
  readonly code = 'TIER_LIMIT_EXCEEDED' as const;
  constructor(
    readonly resource: 'tables' | 'agents' | 'graphEntities',
    readonly current: number,
    readonly limit: number,
  ) {
    super(`Free tier limit reached: ${current}/${limit} ${resource}`);
    this.name = 'TierLimitError';
  }
}
