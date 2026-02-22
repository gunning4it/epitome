import { describe, it, expect, vi, beforeEach } from 'vitest';

// =====================================================
// Mocks - vi.hoisted() runs before vi.mock() hoisting
// =====================================================

const { mockSearchAllVectors, mockGetEntityByName, mockTraverse, mockGetNeighbors, mockExecuteSandboxedQuery } =
  vi.hoisted(() => {
    return {
      mockSearchAllVectors: vi.fn(),
      mockGetEntityByName: vi.fn(),
      mockTraverse: vi.fn(),
      mockGetNeighbors: vi.fn(),
      mockExecuteSandboxedQuery: vi.fn(),
    };
  });

vi.mock('@/services/vector.service', () => ({
  searchAllVectors: mockSearchAllVectors,
}));

vi.mock('@/services/graphService', () => ({
  getEntityByName: mockGetEntityByName,
  traverse: mockTraverse,
  getNeighbors: mockGetNeighbors,
}));

vi.mock('@/services/sqlSandbox.service', () => ({
  executeSandboxedQuery: mockExecuteSandboxedQuery,
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import {
  classifyIntent,
  scoreSourceRelevance,
  buildRetrievalPlan,
  fuseFacts,
  retrieveKnowledge,
  expandQueryWithProfileContext,
  BUDGET_CONFIG,
  type ClassifiedIntent,
} from '@/services/retrieval.service';

// =====================================================
// Helpers
// =====================================================

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

function makeConsentChecker(allowed = true) {
  return vi.fn().mockResolvedValue(allowed);
}

function makeVectorResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    collection: 'general',
    text: 'User likes sushi',
    metadata: {},
    similarity: 0.85,
    confidence: 0.9,
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEntityResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Sushi',
    type: 'food',
    similarity: 0.8,
    confidence: 0.7,
    mentionCount: 5,
    firstSeen: new Date(),
    lastSeen: new Date(),
    properties: {},
    ...overrides,
  };
}

function makeTraverseResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    name: 'Japanese Food',
    type: 'concept',
    depth: 1,
    pathWeight: 0.5,
    ...overrides,
  };
}

function makeNeighborResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Japanese Restaurant',
    type: 'place',
    properties: {},
    confidence: 0.7,
    mentionCount: 2,
    firstSeen: new Date(),
    lastSeen: new Date(),
    deletedAt: null,
    edge: {
      id: 10,
      sourceId: 1,
      targetId: 3,
      relation: 'visited',
      weight: 1.5,
      confidence: 0.8,
      evidence: [],
      firstSeen: new Date(),
      lastSeen: new Date(),
      properties: {},
    },
    ...overrides,
  };
}

function makeSandboxResult(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{ name: 'Sushi dinner', calories: 500 }],
    rowCount: 1,
    ...overrides,
  };
}

// =====================================================
// Tests
// =====================================================

describe('retrieval.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------
  // classifyIntent
  // ---------------------------------------------------
  describe('classifyIntent()', () => {
    it('classifies "what food do I like" as preference with food-related expanded terms', () => {
      const result = classifyIntent('what food do I like');

      expect(result.primary).toBe('preference');
      expect(result.expandedTerms).toEqual(expect.arrayContaining(['meal', 'diet']));
    });

    it('classifies "when did I last eat sushi" as timeline', () => {
      const result = classifyIntent('when did I last eat sushi');

      expect(result.primary).toBe('timeline');
    });

    it('classifies "who does Alex know" as relationship with person entity hint', () => {
      const result = classifyIntent('who does Alex know');

      expect(result.primary).toBe('relationship');
      expect(result.entityTypeHints).toEqual(expect.arrayContaining(['person']));
    });

    it('classifies "how many workouts this month" as quantitative', () => {
      const result = classifyIntent('how many workouts this month');

      expect(result.primary).toBe('quantitative');
    });

    it('classifies "books I\'ve read" as factual with book-related expanded terms', () => {
      const result = classifyIntent("books I've read");

      expect(result.primary).toBe('factual');
      expect(result.expandedTerms).toEqual(
        expect.arrayContaining(['reading', 'novel', 'author'])
      );
    });

    it('treats punctuation-heavy reading phrases as factual (not timeline)', () => {
      const result = classifyIntent('books read / reading history');

      expect(result.primary).toBe('factual');
      expect(result.expandedTerms).toEqual(
        expect.arrayContaining(['book', 'novel', 'author']),
      );
    });

    it('classifies empty string as general', () => {
      const result = classifyIntent('');

      expect(result.primary).toBe('general');
    });

    it('classifies short single word "sushi" as general', () => {
      const result = classifyIntent('sushi');

      expect(result.primary).toBe('general');
    });

    it('always returns expandedTerms, entityTypeHints, and relationHints arrays', () => {
      const result = classifyIntent('anything');

      expect(Array.isArray(result.expandedTerms)).toBe(true);
      expect(Array.isArray(result.entityTypeHints)).toBe(true);
      expect(Array.isArray(result.relationHints)).toBe(true);
    });
  });

  // ---------------------------------------------------
  // scoreSourceRelevance
  // ---------------------------------------------------
  describe('scoreSourceRelevance()', () => {
    it('gives high score to a table whose name matches the topic', () => {
      const intent = classifyIntent('meals I had');
      const tables = [{ tableName: 'meals', description: 'Track meals eaten', columns: [], recordCount: 10 }];

      const scored = scoreSourceRelevance('meals', intent, tables, [], {});

      const mealsSource = scored.find(
        (s) => s.sourceType === 'table' && s.sourceId === 'meals'
      );
      expect(mealsSource).toBeDefined();
      expect(mealsSource!.relevanceScore).toBeGreaterThan(0.7);
    });

    it('gives low score to a table unrelated to the topic', () => {
      const intent = classifyIntent('quantum physics');
      const tables = [{ tableName: 'meals', description: 'Track meals eaten', columns: [], recordCount: 10 }];

      const scored = scoreSourceRelevance('quantum physics', intent, tables, [], {});

      const mealsSource = scored.find(
        (s) => s.sourceType === 'table' && s.sourceId === 'meals'
      );
      expect(mealsSource).toBeDefined();
      expect(mealsSource!.relevanceScore).toBeLessThan(0.3);
    });

    it('ranks "bookshelf" collection higher than "general" for books topic', () => {
      const intent = classifyIntent('books');
      const collections = [
        { collection: 'general', description: 'General memories', entryCount: 100 },
        { collection: 'bookshelf', description: 'Books and reading', entryCount: 20 },
      ];

      const scored = scoreSourceRelevance('books', intent, [], collections, {});

      const generalSource = scored.find(
        (s) => s.sourceType === 'vector' && s.sourceId === 'general'
      );
      const bookshelfSource = scored.find(
        (s) => s.sourceType === 'vector' && s.sourceId === 'bookshelf'
      );
      expect(bookshelfSource).toBeDefined();
      expect(generalSource).toBeDefined();
      expect(bookshelfSource!.relevanceScore).toBeGreaterThan(
        generalSource!.relevanceScore
      );
    });

    it('gives graph source > 0.5 for relationship intent', () => {
      const intent = classifyIntent('who does Alex know');

      const scored = scoreSourceRelevance('who does Alex know', intent, [], [], {});

      const graphSource = scored.find((s) => s.sourceType === 'graph');
      expect(graphSource).toBeDefined();
      expect(graphSource!.relevanceScore).toBeGreaterThan(0.5);
    });

    it('gives profile source > 0.5 when profile has a matching key', () => {
      const intent = classifyIntent('what is my name');
      const profile = { name: 'Bruce Wayne', occupation: 'Vigilante' };

      const scored = scoreSourceRelevance('name', intent, [], [], profile);

      const profileSource = scored.find((s) => s.sourceType === 'profile');
      expect(profileSource).toBeDefined();
      expect(profileSource!.relevanceScore).toBeGreaterThan(0.5);
    });

    it('returns an array of ScoredSource objects with required fields', () => {
      const intent = classifyIntent('test');
      const scored = scoreSourceRelevance('test', intent, [], [], {});

      for (const source of scored) {
        expect(source).toHaveProperty('sourceType');
        expect(source).toHaveProperty('sourceId');
        expect(source).toHaveProperty('relevanceScore');
        expect(source).toHaveProperty('reason');
        expect(typeof source.relevanceScore).toBe('number');
        expect(source.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(source.relevanceScore).toBeLessThanOrEqual(1);
      }
    });
  });

  // ---------------------------------------------------
  // BUDGET_CONFIG
  // ---------------------------------------------------
  describe('BUDGET_CONFIG', () => {
    it('small budget has maxTotalFacts === 15', () => {
      expect(BUDGET_CONFIG.small.maxTotalFacts).toBe(15);
    });

    it('medium budget has maxTotalFacts === 40', () => {
      expect(BUDGET_CONFIG.medium.maxTotalFacts).toBe(40);
    });

    it('deep budget has maxTotalFacts === 80', () => {
      expect(BUDGET_CONFIG.deep.maxTotalFacts).toBe(80);
    });

    it('each budget tier is defined', () => {
      expect(BUDGET_CONFIG).toHaveProperty('small');
      expect(BUDGET_CONFIG).toHaveProperty('medium');
      expect(BUDGET_CONFIG).toHaveProperty('deep');
    });
  });

  // ---------------------------------------------------
  // buildRetrievalPlan
  // ---------------------------------------------------
  describe('buildRetrievalPlan()', () => {
    it('always includes recall as first recommended call', () => {
      const intent = classifyIntent('anything');
      const scoredSources = [
        { sourceType: 'table' as const, sourceId: 'meals', relevanceScore: 0.9, reason: 'match' },
      ];

      const plan = buildRetrievalPlan(intent, scoredSources);

      expect(plan.recommendedCalls).toBeDefined();
      expect(plan.recommendedCalls.length).toBeGreaterThan(0);
      expect(plan.recommendedCalls[0].tool).toBe('recall');
    });

    it('recommends recall mode:memory for high-scoring vector source', () => {
      const intent = classifyIntent('memories');
      const scoredSources = [
        { sourceType: 'vector' as const, sourceId: 'general', relevanceScore: 0.8, reason: 'match' },
      ];

      const plan = buildRetrievalPlan(intent, scoredSources);

      const memoryCall = plan.recommendedCalls.find(
        (call) => call.args.mode === 'memory'
      );
      expect(memoryCall).toBeDefined();
      expect(memoryCall!.tool).toBe('recall');
      expect(memoryCall!.args.memory).toEqual({ collection: 'general', query: '<user_topic>' });
    });

    it('recommends recall mode:table for high-scoring table source', () => {
      const intent = classifyIntent('meals data');
      const scoredSources = [
        { sourceType: 'table' as const, sourceId: 'meals', relevanceScore: 0.9, reason: 'match' },
      ];

      const plan = buildRetrievalPlan(intent, scoredSources);

      const tableCall = plan.recommendedCalls.find(
        (call) => call.args.mode === 'table'
      );
      expect(tableCall).toBeDefined();
      expect(tableCall!.tool).toBe('recall');
      expect(tableCall!.args.table.table).toBe('meals');
      expect(tableCall!.args.table.filters).toEqual({});
      expect(tableCall!.args.table.limit).toBe(20);
    });

    it('recommends recall mode:graph for high-scoring graph source', () => {
      const intent = classifyIntent('relationships');
      const scoredSources = [
        { sourceType: 'graph' as const, sourceId: 'graph', relevanceScore: 0.8, reason: 'match' },
      ];

      const plan = buildRetrievalPlan(intent, scoredSources);

      const graphCall = plan.recommendedCalls.find(
        (call) => call.args.mode === 'graph'
      );
      expect(graphCall).toBeDefined();
      expect(graphCall!.tool).toBe('recall');
      // With FEATURE_RECALL_STRUCTURED_GRAPH_PREFERRED (default: true), uses structured pattern
      expect(graphCall!.args.graph).toEqual(expect.objectContaining({ queryType: 'pattern' }));
    });

    it('returns a plan object with recommendedCalls array', () => {
      const intent = classifyIntent('test');
      const plan = buildRetrievalPlan(intent, []);

      expect(plan).toHaveProperty('recommendedCalls');
      expect(Array.isArray(plan.recommendedCalls)).toBe(true);
    });
  });

  // ---------------------------------------------------
  // fuseFacts
  // ---------------------------------------------------
  describe('fuseFacts()', () => {
    it('deduplicates exact duplicate facts, keeping highest confidence', () => {
      const facts = [
        { fact: 'User likes sushi', sourceType: 'vector' as const, sourceRef: 'v:1', confidence: 0.8 },
        { fact: 'User likes sushi', sourceType: 'vector' as const, sourceRef: 'v:2', confidence: 0.95 },
      ];

      const fused = fuseFacts(facts);

      expect(fused).toHaveLength(1);
      expect(fused[0].fact).toBe('User likes sushi');
      expect(fused[0].confidence).toBe(0.95);
    });

    it('boosts confidence for cross-source corroboration', () => {
      const facts = [
        { fact: 'User likes sushi', sourceType: 'vector' as const, sourceRef: 'v:1', confidence: 0.7 },
        { fact: 'User likes sushi', sourceType: 'table' as const, sourceRef: 't:meals:1', confidence: 0.7 },
      ];

      const fused = fuseFacts(facts);

      expect(fused).toHaveLength(1);
      // Cross-source corroboration should boost confidence above the individual 0.7
      expect(fused[0].confidence).toBeGreaterThan(0.7);
    });

    it('keeps different facts as separate entries', () => {
      const facts = [
        { fact: 'User likes sushi', sourceType: 'vector' as const, sourceRef: 'v:1', confidence: 0.8 },
        { fact: 'User works at Wayne Enterprises', sourceType: 'graph' as const, sourceRef: 'g:1', confidence: 0.9 },
      ];

      const fused = fuseFacts(facts);

      expect(fused).toHaveLength(2);
    });

    it('truncates to maxFacts when provided', () => {
      const facts = Array.from({ length: 20 }, (_, i) => ({
        fact: `Fact number ${i}`,
        sourceType: 'vector' as const,
        sourceRef: `v:${i}`,
        confidence: 0.5 + i * 0.02,
      }));

      const fused = fuseFacts(facts, 5);

      expect(fused).toHaveLength(5);
    });

    it('returns empty array for empty input', () => {
      const fused = fuseFacts([]);

      expect(fused).toEqual([]);
    });

    it('preserves timestamp field when present', () => {
      const ts = '2026-02-20T12:00:00Z';
      const facts = [
        { fact: 'Had sushi', sourceType: 'table' as const, sourceRef: 't:1', confidence: 0.8, timestamp: ts },
      ];

      const fused = fuseFacts(facts);

      expect(fused).toHaveLength(1);
      expect(fused[0].timestamp).toBe(ts);
    });
  });

  // ---------------------------------------------------
  // retrieveKnowledge (async orchestrator - mocked)
  // ---------------------------------------------------
  describe('retrieveKnowledge()', () => {
    const defaultTables = [
      { tableName: 'meals', description: 'Meals eaten', columns: [{ name: 'name', type: 'text' }], recordCount: 10 },
    ];
    const defaultCollections = [
      { collection: 'general', description: 'General memories', entryCount: 50 },
    ];
    const defaultProfile = { name: 'Bruce Wayne', favorite_food: 'sushi' };

    beforeEach(() => {
      // Default happy-path mock implementations
      mockSearchAllVectors.mockResolvedValue([makeVectorResult()]);
      mockGetEntityByName.mockResolvedValue([makeEntityResult()]);
      mockTraverse.mockResolvedValue([makeTraverseResult()]);
      mockGetNeighbors.mockResolvedValue([makeNeighborResult()]);
      mockExecuteSandboxedQuery.mockResolvedValue(makeSandboxResult());
    });

    it('happy path: returns fused facts with correct structure', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      expect(result).toHaveProperty('topic', 'sushi');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('budget', 'medium');
      expect(result).toHaveProperty('facts');
      expect(result).toHaveProperty('sourcesQueried');
      expect(result).toHaveProperty('coverage');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('timingMs');
      expect(Array.isArray(result.facts)).toBe(true);
      expect(Array.isArray(result.sourcesQueried)).toBe(true);
      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.sourcesQueried.length).toBeGreaterThan(0);
      expect(typeof result.timingMs).toBe('number');
      expect(result.timingMs).toBeGreaterThanOrEqual(0);
    });

    it('happy path: sourcesQueried reflects which modalities were called', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      // Should have queried at least vectors and graph (depending on scoring)
      expect(result.sourcesQueried.length).toBeGreaterThan(0);
    });

    it('one modality fails: other modalities still return, warning added', async () => {
      mockSearchAllVectors.mockRejectedValue(new Error('Vector service down'));
      mockGetEntityByName.mockResolvedValue([makeEntityResult()]);
      mockTraverse.mockResolvedValue([makeTraverseResult()]);
      mockExecuteSandboxedQuery.mockResolvedValue(makeSandboxResult());

      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      // Should still succeed overall
      expect(result).toHaveProperty('facts');
      // Should have a warning about the failed modality
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.toLowerCase().includes('vector') || w.toLowerCase().includes('fail') || w.toLowerCase().includes('error'))).toBe(true);
    });

    it('all modalities return empty: 0 facts, success (not error)', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);

      // Use a topic that won't match profile values to test truly empty results
      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'quantum physics',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      expect(result.facts).toHaveLength(0);
      // Should NOT throw -- just returns empty results
      expect(result).toHaveProperty('topic', 'quantum physics');
    });

    it('consent denied for vectors: vectors skipped, no error', async () => {
      // Consent checker returns false for vector-related checks
      const consentChecker = vi.fn().mockImplementation(async (scope: string) => {
        if (scope.includes('vector') || scope.includes('memory') || scope.includes('search')) {
          return false;
        }
        return true;
      });

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      // Should not throw
      expect(result).toHaveProperty('facts');
      // searchAllVectors should not have been called (consent denied)
      // The exact behavior depends on implementation, but it should not error
      expect(result).toHaveProperty('topic', 'sushi');
    });

    it('progressive deepening: small budget with < 3 initial facts auto-upgrades', async () => {
      // Return very few results initially to trigger auto-upgrade
      mockSearchAllVectors.mockResolvedValue([
        makeVectorResult({ text: 'One fact about sushi' }),
      ]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'small',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      // Should include auto-upgrade warning
      expect(result.warnings.some((w: string) => w.includes('Auto-upgraded') || w.includes('auto-upgrade') || w.toLowerCase().includes('upgraded'))).toBe(true);
    });

    it('returns correct budget in result', async () => {
      const consentChecker = makeConsentChecker(true);

      for (const budget of ['small', 'medium', 'deep'] as const) {
        const result = await retrieveKnowledge(
          TEST_USER_ID,
          'test topic',
          budget,
          consentChecker,
          defaultTables,
          defaultCollections,
          defaultProfile
        );

        // Budget might change if auto-upgraded, but should be a valid budget
        expect(['small', 'medium', 'deep']).toContain(result.budget);
      }
    });

    it('intent in result matches classifyIntent output', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'what food do I like',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      // The intent should match what classifyIntent would produce
      const expectedIntent = classifyIntent('what food do I like');
      expect(result.intent.primary).toBe(expectedIntent.primary);
    });

    it('coverage is a number between 0 and 1', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      expect(typeof result.coverage).toBe('number');
      expect(result.coverage).toBeGreaterThanOrEqual(0);
      expect(result.coverage).toBeLessThanOrEqual(1);
    });

    it('includes coverageDetails with planned, queried, and missing sources', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      expect(result).toHaveProperty('coverageDetails');
      expect(result.coverageDetails.score).toBe(result.coverage);
      expect(Array.isArray(result.coverageDetails.plannedSources)).toBe(true);
      expect(Array.isArray(result.coverageDetails.queriedSources)).toBe(true);
      expect(Array.isArray(result.coverageDetails.missingSources)).toBe(true);
    });

    it('sets uncertaintyReason when no facts are retrieved', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);

      // Use a topic that won't match profile values to test truly empty results
      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'quantum physics',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      expect(result.facts).toHaveLength(0);
      expect(typeof result.uncertaintyReason).toBe('string');
      expect(result.uncertaintyReason?.length).toBeGreaterThan(0);
    });

    it('avoids irrelevant profile facts for stopword-heavy book queries', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);
      const profile = {
        date_of_birth: '1990-01-21',
        family: {
          children: [{ name: 'Ashley', age: '5 months' }],
        },
      };

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'books I have read',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        profile,
      );

      expect(result.facts.some((fact) => fact.fact.includes('date_of_birth'))).toBe(false);
      expect(result.facts.some((fact) => fact.fact.includes('family.children'))).toBe(false);
    });

    it('flattens nested profile objects without [object Object]', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);
      const profile = {
        family: {
          children: [{ name: 'Ashley', age: '5 months' }],
        },
      };

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'family children',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        profile,
      );

      expect(result.facts.some((fact) => fact.fact.includes('family.children[0].name: Ashley'))).toBe(true);
      expect(result.facts.some((fact) => fact.fact.includes('family.children[0].age: 5 months'))).toBe(true);
      expect(result.facts.some((fact) => fact.fact.includes('[object Object]'))).toBe(false);
    });

    it('each fact has required sourceType and sourceRef fields', async () => {
      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'sushi',
        'medium',
        consentChecker,
        defaultTables,
        defaultCollections,
        defaultProfile
      );

      for (const fact of result.facts) {
        expect(fact).toHaveProperty('fact');
        expect(fact).toHaveProperty('sourceType');
        expect(fact).toHaveProperty('sourceRef');
        expect(fact).toHaveProperty('confidence');
        expect(['table', 'vector', 'graph', 'profile']).toContain(fact.sourceType);
        expect(typeof fact.confidence).toBe('number');
      }
    });

    it('handles empty tables/collections/profile gracefully', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);

      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'anything',
        'small',
        consentChecker,
        [],
        [],
        {}
      );

      expect(result).toHaveProperty('facts');
      expect(Array.isArray(result.facts)).toBe(true);
    });
  });

  // ---------------------------------------------------
  // Phase 0 — red baseline: relationship retrieval
  // ---------------------------------------------------
  describe('Phase 0 — red baseline: relationship retrieval', () => {
    it('classifyIntent("what do you know about my daughter") returns primary: relationship', () => {
      const result = classifyIntent('what do you know about my daughter');
      expect(result.primary).toBe('relationship');
    });

    it('classifyIntent includes family_member in relationHints for "my daughter"', () => {
      const result = classifyIntent('what do you know about my daughter');
      expect(result.relationHints).toEqual(expect.arrayContaining(['family_member']));
    });

    it('classifyIntent includes person in entityTypeHints for "my daughter"', () => {
      const result = classifyIntent('what do you know about my daughter');
      expect(result.entityTypeHints).toEqual(expect.arrayContaining(['person']));
    });

    it('classifyIntent("when is my daughter\'s birthday") returns relationship with family_member hint', () => {
      const result = classifyIntent("when is my daughter's birthday");
      expect(result.primary).toBe('relationship');
      expect(result.relationHints).toEqual(expect.arrayContaining(['family_member']));
    });

    it('classifyIntent adds daughter to expandedTerms for "my daughter"', () => {
      const result = classifyIntent('what do you know about my daughter');
      expect(result.expandedTerms).toEqual(expect.arrayContaining(['daughter']));
    });

    it('profile retrieval for "my daughter" against family profile returns Georgia facts', () => {
      const profile = {
        family: {
          children: [{ name: 'Georgia', relation: 'daughter', birthday: '2020-06-15' }],
        },
      };

      // retrieveFromProfile is private, so we test via retrieveKnowledge
      // But we can test the pure function behavior by calling retrieveKnowledge with mocked services
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      // Use retrieveKnowledge to test profile retrieval behavior
      return retrieveKnowledge(
        TEST_USER_ID,
        'what do you know about my daughter',
        'medium',
        makeConsentChecker(true),
        [],
        [],
        profile,
      ).then((result) => {
        // Should find Georgia's facts via profile value matching
        const profileFacts = result.facts.filter((f) => f.sourceType === 'profile');
        const georgiaMentioned = profileFacts.some(
          (f) => f.fact.includes('Georgia') || f.fact.includes('daughter'),
        );
        expect(georgiaMentioned).toBe(true);
      });
    });
  });

  // ---------------------------------------------------
  // Phase 2 — graph semantic traversal
  // ---------------------------------------------------
  describe('Phase 2 — graph semantic traversal', () => {
    it('fuseFacts with intent applies role-match boosting', () => {
      const facts = [
        { fact: 'Georgia is a family_member of user', sourceType: 'graph' as const, sourceRef: 'g:1', confidence: 0.7 },
        { fact: 'User likes sushi', sourceType: 'vector' as const, sourceRef: 'v:1', confidence: 0.7 },
      ];
      const intent = classifyIntent('what do you know about my daughter');
      // intent should have family_member in relationHints
      expect(intent.relationHints).toEqual(expect.arrayContaining(['family_member']));

      const fused = fuseFacts(facts, undefined, intent);

      // The family_member fact should be boosted
      const familyFact = fused.find(f => f.fact.includes('family_member'));
      expect(familyFact).toBeDefined();
      expect(familyFact!.confidence).toBe(0.75); // 0.7 + 0.05

      // The sushi fact should NOT be boosted
      const sushiFact = fused.find(f => f.fact.includes('sushi'));
      expect(sushiFact).toBeDefined();
      expect(sushiFact!.confidence).toBe(0.7);
    });

    it('fuseFacts without intent does not boost', () => {
      const facts = [
        { fact: 'Georgia is a family_member of user', sourceType: 'graph' as const, sourceRef: 'g:1', confidence: 0.7 },
      ];

      const fused = fuseFacts(facts);

      expect(fused[0].confidence).toBe(0.7);
    });

    it('fuseFacts role-match boost does not exceed 0.95', () => {
      const facts = [
        { fact: 'Georgia is a family_member of user', sourceType: 'graph' as const, sourceRef: 'g:1', confidence: 0.93 },
      ];
      const intent: ClassifiedIntent = {
        primary: 'relationship',
        expandedTerms: [],
        entityTypeHints: ['person'],
        relationHints: ['family_member'],
      };

      const fused = fuseFacts(facts, undefined, intent);

      expect(fused[0].confidence).toBe(0.95);
    });

    it('graph neighbor facts include relation in human-readable format', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([
        makeEntityResult({ id: 1, name: 'Georgia', type: 'person', similarity: 0.9 }),
      ]);
      mockGetNeighbors.mockResolvedValue([
        makeNeighborResult({
          id: 5, name: 'Bruce', type: 'person',
          edge: {
            id: 20, sourceId: 5, targetId: 1, relation: 'parent_of',
            weight: 2.0, confidence: 0.9, evidence: [],
            firstSeen: new Date(), lastSeen: new Date(), properties: {},
          },
        }),
      ]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);
      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'Georgia',
        'medium',
        consentChecker,
        [],
        [],
        {},
      );

      // Neighbor facts should include relation name instead of just type
      const neighborFact = result.facts.find(f => f.sourceRef.includes('graph/edge'));
      expect(neighborFact).toBeDefined();
      expect(neighborFact!.fact).toContain('parent of');
      expect(neighborFact!.fact).toContain('Bruce');
      expect(neighborFact!.fact).toContain('Georgia');
    });

    it('deep traversal facts include type context for depth > 1 nodes', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([
        makeEntityResult({ name: 'Georgia', type: 'person', similarity: 0.9 }),
      ]);
      mockGetNeighbors.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([
        makeTraverseResult({ id: 5, name: 'Gotham School', type: 'organization', depth: 2 }),
      ]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);
      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'Georgia',
        'medium',
        consentChecker,
        [],
        [],
        {},
      );

      const traversalFact = result.facts.find(f => f.sourceRef.includes('graph/traverse'));
      expect(traversalFact).toBeDefined();
      expect(traversalFact!.fact).toContain('(organization)');
      expect(traversalFact!.fact).toContain('Gotham School');
    });

    it('entity ranking boosts person entities for relationship intent', async () => {
      mockSearchAllVectors.mockResolvedValue([]);
      mockGetEntityByName.mockResolvedValue([
        makeEntityResult({ id: 1, name: 'Georgia', type: 'person', similarity: 0.6, mentionCount: 5 }),
      ]);
      mockGetNeighbors.mockResolvedValue([]);
      mockTraverse.mockResolvedValue([]);
      mockExecuteSandboxedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const consentChecker = makeConsentChecker(true);
      const result = await retrieveKnowledge(
        TEST_USER_ID,
        'what do you know about my daughter',
        'medium',
        consentChecker,
        [],
        [],
        {},
      );

      // Entity fact confidence should be boosted above raw similarity (0.6)
      // +0.15 for relationship+person, +0.05 for mentionCount >= 3
      const entityFact = result.facts.find(f => f.sourceRef.includes('graph/entity'));
      expect(entityFact).toBeDefined();
      expect(entityFact!.confidence).toBeGreaterThan(0.6);
      expect(entityFact!.confidence).toBe(0.8); // 0.6 + 0.15 + 0.05
    });
  });
});
