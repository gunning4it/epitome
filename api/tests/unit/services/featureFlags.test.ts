import { describe, it, expect, afterEach } from 'vitest';
import {
  isFeatureEnabled,
  getFlag,
  setFlag,
  clearFlag,
  clearAllFlags,
  getAllFlags,
} from '@/services/featureFlags';

describe('featureFlags', () => {
  afterEach(() => {
    delete process.env.RETRIEVAL_HARDENING_ENABLED;
    delete process.env.IDENTITY_GUARDRAILS_ENABLED;
    delete process.env.GRAPH_EDGE_VECTORIZATION_ENABLED;
    delete process.env.RECALL_STRUCTURED_GRAPH_PREFERRED;
    delete process.env.FEATURE_GRAPH_EDGE_VECTORIZATION;
    delete process.env.FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED;
    delete process.env.FEATURE_RETRIEVAL_EDGE_VECTORS;
    clearAllFlags();
  });

  describe('isFeatureEnabled (simple env-var API)', () => {
    it('returns false by default when env var is not set', () => {
      expect(isFeatureEnabled('RETRIEVAL_HARDENING_ENABLED')).toBe(false);
    });

    it('returns true when env var is set to "true"', () => {
      process.env.RETRIEVAL_HARDENING_ENABLED = 'true';
      expect(isFeatureEnabled('RETRIEVAL_HARDENING_ENABLED')).toBe(true);
    });

    it('returns false when env var is set to anything other than "true"', () => {
      process.env.RETRIEVAL_HARDENING_ENABLED = 'false';
      expect(isFeatureEnabled('RETRIEVAL_HARDENING_ENABLED')).toBe(false);
      process.env.RETRIEVAL_HARDENING_ENABLED = '1';
      expect(isFeatureEnabled('RETRIEVAL_HARDENING_ENABLED')).toBe(false);
    });
  });

  describe('getFlag (rich API with defaults)', () => {
    it('returns default value when no override or env var', () => {
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(false);
      expect(getFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED')).toBe(false);
      expect(getFlag('FEATURE_RETRIEVAL_EDGE_VECTORS')).toBe(false);
    });

    it('respects env var override', () => {
      process.env.FEATURE_GRAPH_EDGE_VECTORIZATION = 'false';
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(false);

      process.env.FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED = '0';
      expect(getFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED')).toBe(false);
    });

    it('accepts "1" and "true" as truthy env values', () => {
      process.env.FEATURE_GRAPH_EDGE_VECTORIZATION = '1';
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(true);

      process.env.FEATURE_GRAPH_EDGE_VECTORIZATION = 'TRUE';
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(true);
    });
  });

  describe('setFlag / clearFlag (runtime overrides)', () => {
    it('setFlag overrides default', () => {
      setFlag('FEATURE_GRAPH_EDGE_VECTORIZATION', true);
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(true);
    });

    it('setFlag overrides env var', () => {
      process.env.FEATURE_GRAPH_EDGE_VECTORIZATION = 'true';
      setFlag('FEATURE_GRAPH_EDGE_VECTORIZATION', false);
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(false);
    });

    it('clearFlag reverts to env var / default', () => {
      setFlag('FEATURE_GRAPH_EDGE_VECTORIZATION', true);
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(true);

      clearFlag('FEATURE_GRAPH_EDGE_VECTORIZATION');
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(false);
    });

    it('clearAllFlags reverts all overrides', () => {
      setFlag('FEATURE_GRAPH_EDGE_VECTORIZATION', true);
      setFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED', true);
      clearAllFlags();
      expect(getFlag('FEATURE_GRAPH_EDGE_VECTORIZATION')).toBe(false);
      expect(getFlag('FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED')).toBe(false);
    });
  });

  describe('getAllFlags', () => {
    it('returns all flags with current values', () => {
      const flags = getAllFlags();
      expect(flags).toEqual({
        FEATURE_GRAPH_EDGE_VECTORIZATION: false,
        FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED: false,
        FEATURE_RETRIEVAL_EDGE_VECTORS: false,
      });
    });

    it('reflects runtime overrides', () => {
      setFlag('FEATURE_GRAPH_EDGE_VECTORIZATION', true);
      const flags = getAllFlags();
      expect(flags.FEATURE_GRAPH_EDGE_VECTORIZATION).toBe(true);
      expect(flags.FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED).toBe(false);
    });
  });
});
