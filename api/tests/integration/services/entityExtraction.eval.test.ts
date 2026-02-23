/**
 * Entity Extraction Evaluation Test Suite
 *
 * Deterministic tests for rule-based extraction and ontology validation.
 * No LLM, no DB — pure function tests.
 */

import { describe, test, expect } from 'vitest';
import { extractEntitiesRuleBased } from '@/services/entityExtraction';
import { validateEdge } from '@/services/ontology';

describe('Extraction gold dataset', () => {
  describe('rule-based (deterministic)', () => {
    test('profile work → organization + works_at', () => {
      const entities = extractEntitiesRuleBased('profile', {
        work: { company: 'Wayne Enterprises', role: 'CEO' },
      });
      const org = entities.find(e => e.type === 'organization' && e.name === 'Wayne Enterprises');
      expect(org).toBeDefined();
      expect(org!.edge?.relation).toBe('works_at');
      expect(org!.edge?.properties?.role).toBe('CEO');
      expect(org!.edge?.properties?.is_current).toBe(true);
    });

    test('profile education → organization + attended', () => {
      const entities = extractEntitiesRuleBased('profile', {
        education: { institution: 'MIT', degree: 'BS', field: 'Computer Science' },
      });
      const edu = entities.find(e => e.type === 'organization' && e.name === 'MIT');
      expect(edu).toBeDefined();
      expect(edu!.edge?.relation).toBe('attended');
      expect(edu!.properties?.category).toBe('education');
    });

    test('profile interests → activity + interested_in', () => {
      const entities = extractEntitiesRuleBased('profile', {
        interests: ['hiking', 'photography'],
      });
      expect(entities).toHaveLength(2);
      expect(entities[0].type).toBe('activity');
      expect(entities[0].edge?.relation).toBe('interested_in');
    });

    test('profile skills → topic + has_skill', () => {
      const entities = extractEntitiesRuleBased('profile', {
        skills: ['TypeScript', 'PostgreSQL'],
      });
      expect(entities).toHaveLength(2);
      expect(entities[0].type).toBe('topic');
      expect(entities[0].edge?.relation).toBe('has_skill');
    });

    test('family sourceRef preserved', () => {
      const entities = extractEntitiesRuleBased('profile', {
        family: { wife: { name: 'Sarah Chen', interests: ['yoga'] } },
      });
      const yoga = entities.find(e => e.name === 'yoga');
      expect(yoga?.edge?.sourceRef).toEqual({ name: 'Sarah Chen', type: 'person' });
    });

    test('career with primary_job → organization + works_at', () => {
      const entities = extractEntitiesRuleBased('profile', {
        career: { primary_job: { company: 'Acme Corp', title: 'Engineer' } },
      });
      const org = entities.find(e => e.type === 'organization' && e.name === 'Acme Corp');
      expect(org).toBeDefined();
      expect(org!.edge?.relation).toBe('works_at');
      expect(org!.edge?.properties?.role).toBe('Engineer');
    });
  });

  describe('relation matrix enforcement', () => {
    test('food → works_at → person: soft-quarantined (unexpected source)', () => {
      const result = validateEdge('food', 'person', 'works_at');
      expect(result.valid).toBe(true);
      expect(result.quarantine).toBe(true);
      expect(result.error).toContain('unexpected source');
    });

    test('person → works_at → organization: accepted', () => {
      const result = validateEdge('person', 'organization', 'works_at');
      expect(result.valid).toBe(true);
    });

    test('unknown relation: soft-quarantined (valid but flagged)', () => {
      const result = validateEdge('person', 'topic', 'invented_by');
      expect(result.valid).toBe(true);
      expect(result.quarantine).toBe(true);
    });

    test('person → attended → organization: accepted', () => {
      const result = validateEdge('person', 'organization', 'attended');
      expect(result.valid).toBe(true);
    });

    test('person → attended → event: accepted', () => {
      const result = validateEdge('person', 'event', 'attended');
      expect(result.valid).toBe(true);
    });

    test('person → likes → any: accepted (null target)', () => {
      const result = validateEdge('person', 'food', 'likes');
      expect(result.valid).toBe(true);
    });

    test('organization → likes → food: soft-quarantined (unexpected source)', () => {
      const result = validateEdge('organization', 'food', 'likes');
      expect(result.valid).toBe(true);
      expect(result.quarantine).toBe(true);
    });
  });

  describe('generic type inference', () => {
    test('work keywords infer organization type', () => {
      const entities = extractEntitiesRuleBased('unknown_table', {
        work: { company: 'TechCo' },
      });
      const org = entities.find(e => e.name === 'TechCo');
      expect(org?.type).toBe('organization');
    });

    test('education keywords infer organization type', () => {
      const entities = extractEntitiesRuleBased('unknown_table', {
        education: { university: 'Stanford' },
      });
      const edu = entities.find(e => e.name === 'Stanford');
      expect(edu?.type).toBe('organization');
    });

    test('skill keywords infer topic type', () => {
      const entities = extractEntitiesRuleBased('unknown_table', {
        skill: { expertise: 'Machine Learning' },
      });
      const skill = entities.find(e => e.name === 'Machine Learning');
      expect(skill?.type).toBe('topic');
    });
  });
});
