// api/src/services/tools/review.ts

/**
 * Facade: review — check for or resolve memory contradictions.
 *
 * Thin wrapper around existing reviewMemories service.
 */

import { reviewMemories } from './reviewMemories.js';
import type { ToolContext, ToolResult } from './types.js';

export interface ReviewArgs {
  action: 'list' | 'resolve';
  metaId?: number;
  resolution?: 'confirm' | 'reject' | 'keep_both';
}

export async function review(
  args: ReviewArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  return reviewMemories(args, ctx);
}
