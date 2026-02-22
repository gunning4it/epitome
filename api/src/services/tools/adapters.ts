// api/src/services/tools/adapters.ts
import type { ToolResult } from './types.js';

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ChatGptToolResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface EvidenceHint {
  source: string;
  confidence: number;
  count: number;
}

function withMeta(result: ToolResult): Record<string, unknown> {
  if (!result.success) return {};

  const base =
    result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? { ...(result.data as Record<string, unknown>) }
      : { value: result.data };

  if (!result.meta) return base;
  return {
    ...base,
    _meta: result.meta,
  };
}

/**
 * Extract evidence hints from recall-style results that contain facts.
 * Returns undefined when the result doesn't contain fact data.
 */
function buildEvidenceHints(data: Record<string, unknown>): {
  topFacts: string[];
  evidenceSources: EvidenceHint[];
} | undefined {
  const facts = data.facts;
  if (!Array.isArray(facts) || facts.length === 0) return undefined;

  // Build top facts (highest confidence, max 3)
  const sorted = [...facts]
    .filter((f) => typeof f.fact === 'string')
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const topFacts = sorted.slice(0, 3).map((f) => f.fact as string);

  // Aggregate evidence sources
  const sourceMap = new Map<string, { totalConf: number; count: number }>();
  for (const fact of facts) {
    const src = String(fact.sourceType || 'unknown');
    const entry = sourceMap.get(src) ?? { totalConf: 0, count: 0 };
    entry.count++;
    entry.totalConf += Number(fact.confidence ?? 0);
    sourceMap.set(src, entry);
  }

  const evidenceSources: EvidenceHint[] = [...sourceMap.entries()]
    .map(([source, { totalConf, count }]) => ({
      source,
      confidence: Math.round((totalConf / count) * 100) / 100,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return { topFacts, evidenceSources };
}

/**
 * Legacy /mcp adapter.
 *
 * Produces identical output to the current callTool() wrapper:
 * - Success: { content: [{ type: 'text', text: JSON.stringify(data) }] }
 * - Failure: { content: [{ type: 'text', text: message }], isError: true }
 */
export function mcpAdapter(result: ToolResult): McpToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.message }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(withMeta(result)) }],
  };
}

/**
 * ChatGPT Apps /chatgpt-mcp adapter.
 *
 * Returns structuredContent for ChatGPT model reasoning + human-readable
 * message in content. Enriches recall responses with evidence hints:
 * - _hints.topFacts: Top 3 facts by confidence for direct answer candidates
 * - _hints.evidenceSources: Aggregated source types with avg confidence
 */
export function chatgptAdapter(result: ToolResult): ChatGptToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.message }],
      isError: true,
    };
  }

  const warnings = result.meta?.warnings ?? [];
  const warningSuffix = warnings.length > 0 ? `\n\nWarnings: ${warnings.join(' | ')}` : '';

  const structured = withMeta(result);

  // Enrich with evidence hints for recall-style responses
  const hints = buildEvidenceHints(structured);
  if (hints) {
    structured._hints = hints;
  }

  return {
    content: [{ type: 'text', text: `${result.message}${warningSuffix}` }],
    structuredContent: structured,
  };
}
