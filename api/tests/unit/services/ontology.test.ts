import { describe, expect, it } from 'vitest';
import { normalizeEdgeRelation, validateEdge } from '@/services/ontology';

describe('normalizeEdgeRelation', () => {
  it('maps known legacy aliases to canonical relations', () => {
    expect(normalizeEdgeRelation('child_of')).toBe('family_member');
    expect(normalizeEdgeRelation('read_by')).toBe('interested_in');
    expect(normalizeEdgeRelation('performed_by')).toBe('attended');
    expect(normalizeEdgeRelation('author_of')).toBe('related_to');
    expect(normalizeEdgeRelation('birth_of')).toBe('related_to');
  });

  it('normalizes case and surrounding whitespace before mapping', () => {
    expect(normalizeEdgeRelation('  CHILD_OF  ')).toBe('family_member');
    expect(normalizeEdgeRelation('  Read_By')).toBe('interested_in');
  });

  it('keeps unknown relations unchanged so they can be quarantined later', () => {
    const unknown = 'invented_by';
    expect(normalizeEdgeRelation(unknown)).toBe(unknown);

    const validation = validateEdge('person', 'person', normalizeEdgeRelation(unknown));
    expect(validation.valid).toBe(false);
    expect(validation.quarantine).toBe(true);
  });
});
