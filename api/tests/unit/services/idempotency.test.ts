import { describe, it, expect } from 'vitest';
import { canonicalize, computeRequestHash } from '@/services/idempotency.service';

describe('idempotency service', () => {
  describe('canonicalize', () => {
    it('sorts top-level keys', () => {
      const input = { z: 1, a: 2, m: 3 };
      const result = canonicalize(input) as Record<string, unknown>;
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('sorts nested object keys recursively', () => {
      const input = { b: { y: 1, x: 2 }, a: { d: 3, c: 4 } };
      const result = canonicalize(input) as Record<string, Record<string, unknown>>;
      expect(Object.keys(result)).toEqual(['a', 'b']);
      expect(Object.keys(result.a)).toEqual(['c', 'd']);
      expect(Object.keys(result.b)).toEqual(['x', 'y']);
    });

    it('preserves array order', () => {
      const input = { items: [3, 1, 2] };
      const result = canonicalize(input) as Record<string, number[]>;
      expect(result.items).toEqual([3, 1, 2]);
    });

    it('canonicalizes objects inside arrays', () => {
      const input = { items: [{ z: 1, a: 2 }, { b: 3, a: 4 }] };
      const result = canonicalize(input) as Record<string, Record<string, unknown>[]>;
      expect(Object.keys(result.items[0])).toEqual(['a', 'z']);
      expect(Object.keys(result.items[1])).toEqual(['a', 'b']);
    });

    it('handles null', () => {
      expect(canonicalize(null)).toBeNull();
    });

    it('handles primitive values', () => {
      expect(canonicalize(42)).toBe(42);
      expect(canonicalize('hello')).toBe('hello');
      expect(canonicalize(true)).toBe(true);
    });

    it('handles undefined (passthrough)', () => {
      expect(canonicalize(undefined)).toBeUndefined();
    });

    it('handles deeply nested structures', () => {
      const input = { c: { b: { a: { z: 1, y: 2 } } } };
      const result = canonicalize(input) as any;
      expect(Object.keys(result.c.b.a)).toEqual(['y', 'z']);
    });

    it('handles empty object', () => {
      expect(canonicalize({})).toEqual({});
    });

    it('handles empty array', () => {
      expect(canonicalize([])).toEqual([]);
    });
  });

  describe('computeRequestHash', () => {
    it('produces same hash regardless of key order', () => {
      const hash1 = computeRequestHash({ a: 1, b: 2, c: 3 });
      const hash2 = computeRequestHash({ c: 3, a: 1, b: 2 });
      expect(hash1).toBe(hash2);
    });

    it('produces same hash for nested objects regardless of key order', () => {
      const hash1 = computeRequestHash({ outer: { x: 1, y: 2 } });
      const hash2 = computeRequestHash({ outer: { y: 2, x: 1 } });
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different values', () => {
      const hash1 = computeRequestHash({ a: 1, b: 2 });
      const hash2 = computeRequestHash({ a: 1, b: 3 });
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash for different keys', () => {
      const hash1 = computeRequestHash({ a: 1 });
      const hash2 = computeRequestHash({ b: 1 });
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash when array order differs', () => {
      const hash1 = computeRequestHash({ items: [1, 2, 3] });
      const hash2 = computeRequestHash({ items: [3, 2, 1] });
      expect(hash1).not.toBe(hash2);
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const hash = computeRequestHash({ foo: 'bar' });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles null args', () => {
      const hash = computeRequestHash(null);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('undefined values are omitted by JSON.stringify', () => {
      // JSON.stringify drops undefined values — these should hash identically
      const hash1 = computeRequestHash({ a: 1, b: undefined });
      const hash2 = computeRequestHash({ a: 1 });
      expect(hash1).toBe(hash2);
    });
  });
});
