/**
 * Temporal Extraction Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { extractTemporalFromText } from '@/services/temporalExtraction';

// Fixed reference date: Monday, 2026-02-23
const NOW = new Date('2026-02-23T12:00:00Z');

describe('extractTemporalFromText', () => {
  it('should extract "yesterday"', () => {
    const result = extractTemporalFromText('I went hiking yesterday', NOW);
    expect(result).toEqual({ date: '2026-02-22', precision: 'day' });
  });

  it('should extract "today"', () => {
    const result = extractTemporalFromText('I am going out today', NOW);
    expect(result).toEqual({ date: '2026-02-23', precision: 'day' });
  });

  it('should extract "last Tuesday"', () => {
    // 2026-02-23 is Monday, last Tuesday = 2026-02-17
    const result = extractTemporalFromText('I went hiking last Tuesday', NOW);
    expect(result).toEqual({ date: '2026-02-17', precision: 'day' });
  });

  it('should extract "last Monday" (not today)', () => {
    // 2026-02-23 is Monday, last Monday = 2026-02-16
    const result = extractTemporalFromText('We met last Monday', NOW);
    expect(result).toEqual({ date: '2026-02-16', precision: 'day' });
  });

  it('should extract "last Friday"', () => {
    // 2026-02-23 is Monday, last Friday = 2026-02-20
    const result = extractTemporalFromText('Had dinner last Friday', NOW);
    expect(result).toEqual({ date: '2026-02-20', precision: 'day' });
  });

  it('should extract "last week"', () => {
    const result = extractTemporalFromText('We traveled last week', NOW);
    expect(result).toEqual({ date: '2026-02-16', precision: 'approx' });
  });

  it('should extract "last month"', () => {
    const result = extractTemporalFromText('We moved last month', NOW);
    expect(result).toEqual({ date: '2026-01-01', precision: 'month' });
  });

  it('should extract "last year"', () => {
    const result = extractTemporalFromText('Graduated last year', NOW);
    expect(result).toEqual({ date: '2025-01-01', precision: 'year' });
  });

  it('should extract "in January"', () => {
    const result = extractTemporalFromText('We moved here in January', NOW);
    expect(result).toEqual({ date: '2026-01-01', precision: 'month' });
  });

  it('should extract "in January 2025"', () => {
    const result = extractTemporalFromText('Started the job in January 2025', NOW);
    expect(result).toEqual({ date: '2025-01-01', precision: 'month' });
  });

  it('should extract "in December" (month rollover)', () => {
    // "last December" in February → still same year default
    const result = extractTemporalFromText('Visited Paris in December', NOW);
    expect(result).toEqual({ date: '2026-12-01', precision: 'month' });
  });

  it('should extract explicit ISO date "2026-03-15"', () => {
    const result = extractTemporalFromText('The meeting is on 2026-03-15', NOW);
    expect(result).toEqual({ date: '2026-03-15', precision: 'day' });
  });

  it('should extract explicit date with slashes "2026/03/15"', () => {
    const result = extractTemporalFromText('Due date: 2026/03/15', NOW);
    expect(result).toEqual({ date: '2026-03-15', precision: 'day' });
  });

  it('should extract "March 15" as day precision', () => {
    const result = extractTemporalFromText('The party is on March 15', NOW);
    expect(result).toEqual({ date: '2026-03-15', precision: 'day' });
  });

  it('should extract "March 15, 2025" with explicit year', () => {
    const result = extractTemporalFromText('Born on March 15, 2025', NOW);
    expect(result).toEqual({ date: '2025-03-15', precision: 'day' });
  });

  it('should return null for no temporal reference', () => {
    const result = extractTemporalFromText('I like pizza and sushi', NOW);
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = extractTemporalFromText('', NOW);
    expect(result).toBeNull();
  });

  it('should handle ordinal dates like "March 15th"', () => {
    const result = extractTemporalFromText('The event is on March 15th', NOW);
    expect(result).toEqual({ date: '2026-03-15', precision: 'day' });
  });
});
