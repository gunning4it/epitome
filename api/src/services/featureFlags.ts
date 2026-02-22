/**
 * Feature Flags Module
 *
 * Runtime-toggleable feature flags for gradual rollout of new behavior.
 * Flags default to sensible values and can be overridden via environment
 * variables or programmatically for testing.
 *
 * Two APIs:
 *   - getFlag / setFlag / clearFlag: rich interface with runtime overrides
 *     (FEATURE_* naming, defaults to true)
 *   - isFeatureEnabled: simple env-var check for *_ENABLED flags
 *     (defaults to false for safe rollout)
 */

export interface FeatureFlags {
  /** Vectorize edge summaries into the 'graph_edges' collection on edge create */
  FEATURE_GRAPH_EDGE_VECTORIZATION: boolean;

  /** Prefer structured graph queries (queryPatternStructured) over NL pattern matching */
  FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED: boolean;

  /** Include edge summary vectors in retrieval fan-out */
  FEATURE_RETRIEVAL_EDGE_VECTORS: boolean;
}

const defaults: FeatureFlags = {
  FEATURE_GRAPH_EDGE_VECTORIZATION: false,
  FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED: false,
  FEATURE_RETRIEVAL_EDGE_VECTORS: false,
};

/**
 * Simple env-var feature flags (default false for safe rollout).
 */
export type FeatureFlag =
  | 'RETRIEVAL_HARDENING_ENABLED'
  | 'IDENTITY_GUARDRAILS_ENABLED'
  | 'GRAPH_EDGE_VECTORIZATION_ENABLED'
  | 'RECALL_STRUCTURED_GRAPH_PREFERRED';

/**
 * Check if a feature flag is enabled.
 * Reads from process.env, defaults to false.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[flag] === 'true';
}

/**
 * Runtime overrides (for testing or programmatic control).
 * Takes precedence over env vars and defaults.
 */
const overrides = new Map<keyof FeatureFlags, boolean>();

function envBool(key: string): boolean | undefined {
  const val = process.env[key];
  if (val === undefined || val === '') return undefined;
  return val === '1' || val.toLowerCase() === 'true';
}

/**
 * Get the current value of a feature flag.
 *
 * Resolution order: runtime override > env var > default
 */
export function getFlag(flag: keyof FeatureFlags): boolean {
  if (overrides.has(flag)) return overrides.get(flag)!;
  const fromEnv = envBool(flag);
  if (fromEnv !== undefined) return fromEnv;
  return defaults[flag];
}

/**
 * Set a runtime override for a feature flag (useful in tests).
 */
export function setFlag(flag: keyof FeatureFlags, value: boolean): void {
  overrides.set(flag, value);
}

/**
 * Clear a runtime override, reverting to env var / default.
 */
export function clearFlag(flag: keyof FeatureFlags): void {
  overrides.delete(flag);
}

/**
 * Clear all runtime overrides.
 */
export function clearAllFlags(): void {
  overrides.clear();
}

/**
 * Get all current flag values (for diagnostics / admin endpoints).
 */
export function getAllFlags(): FeatureFlags {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof FeatureFlags>) {
    result[key] = getFlag(key);
  }
  return result;
}
