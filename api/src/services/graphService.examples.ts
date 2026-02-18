/**
 * GraphService Usage Examples
 *
 * Real-world usage patterns for the knowledge graph API.
 * These examples demonstrate common workflows and best practices.
 */

import {
  createEntity,
  createEdge,
  getNeighbors,
  listEntities,
  getEntityByName,
} from './graphService';

const userId = 'example-user-id';

// =====================================================
// EXAMPLE 1: Building a Family Graph
// =====================================================

async function buildFamilyGraph() {
  // Create family member entities
  const user = await createEntity(userId, {
    type: 'person',
    name: 'Alex Chen',
    properties: { relation: 'self' },
    origin: 'user_stated',
  });

  const wife = await createEntity(userId, {
    type: 'person',
    name: 'Sarah Chen',
    properties: {
      relation: 'wife',
      birthday: '1992-05-20',
      dietary: ['gluten-free'],
    },
    origin: 'user_stated',
  });

  const daughter = await createEntity(userId, {
    type: 'person',
    name: 'Emma Chen',
    properties: {
      relation: 'daughter',
      age: 5,
      dietary: ['dairy-free'],
    },
    origin: 'user_stated',
  });

  // Create relationships
  await createEdge(userId, {
    sourceId: user.id,
    targetId: wife.id,
    relation: 'married_to',
    weight: 2.0,
    evidence: [{ type: 'profile', path: 'family[0]' }],
    origin: 'user_stated',
  });

  await createEdge(userId, {
    sourceId: user.id,
    targetId: daughter.id,
    relation: 'parent_of',
    weight: 2.0,
    evidence: [{ type: 'profile', path: 'family[1]' }],
    origin: 'user_stated',
  });

  await createEdge(userId, {
    sourceId: wife.id,
    targetId: daughter.id,
    relation: 'parent_of',
    weight: 2.0,
    origin: 'user_stated',
  });

  console.log('Family graph created:', { user, wife, daughter });
}

// =====================================================
// EXAMPLE 2: Recording Restaurant Preferences
// =====================================================

async function recordRestaurantVisit() {
  // Find or create restaurant
  let restaurants = await  getEntityByName(userId, 'Bestia', 'place');
  let bestia;

  if (restaurants.length === 0) {
    // Create restaurant entity
    bestia = await createEntity(userId, {
      type: 'place',
      name: 'Bestia',
      properties: {
        cuisine: 'Italian',
        address: '2121 E 7th Pl, Los Angeles, CA',
        rating: 4.8,
        priceRange: '$$$',
      },
      origin: 'user_stated',
    });
  } else {
    bestia = restaurants[0];
  }

  // Create Italian food entity
  const italianFood = await createEntity(userId, {
    type: 'food',
    name: 'Italian Food',
    properties: { cuisine: 'Italian' },
    origin: 'ai_inferred',
  });

  // Link user to restaurant (visited)
  const visitEdge = await createEdge(userId, {
    sourceId: 1, // User entity ID (assume exists)
    targetId: bestia.id,
    relation: 'visited',
    weight: 1.0,
    evidence: [
      {
        type: 'table',
        table: 'meals',
        row_id: 123,
        date: '2026-02-10',
      },
    ],
    origin: 'ai_inferred',
  });

  // Link user to Italian food (likes)
  await createEdge(userId, {
    sourceId: 1,
    targetId: italianFood.id,
    relation: 'likes',
    weight: 1.0,
    origin: 'ai_pattern',
  });

  // Link restaurant to Italian food (category)
  await createEdge(userId, {
    sourceId: bestia.id,
    targetId: italianFood.id,
    relation: 'category',
    weight: 1.0,
    origin: 'system',
  });

  console.log('Restaurant visit recorded:', { bestia, visitEdge });

  // If user visits again, the edge weight will increment
  const secondVisit = await createEdge(userId, {
    sourceId: 1,
    targetId: bestia.id,
    relation: 'visited', // Same relation = deduplication
    weight: 0.5,
    evidence: [
      {
        type: 'table',
        table: 'meals',
        row_id: 456,
        date: '2026-02-12',
      },
    ],
    origin: 'ai_inferred',
  });

  console.log('Second visit deduped, weight incremented:', secondVisit.weight); // 1.5
}

// =====================================================
// EXAMPLE 3: Finding Context for Recommendations
// =====================================================

async function getRecommendationContext() {
  // Find user entity
  const users = await listEntities(userId, {
    type: 'person',
    confidenceMin: 0.9,
  });
  const user = users.find((e) => e.properties.relation === 'self');

  if (!user) {
    throw new Error('User entity not found');
  }

  // Get all places user has visited
  const visitedPlaces = await getNeighbors(userId, user.id, {
    direction: 'outbound',
    relationFilter: 'visited',
  });

  console.log('Visited places:', visitedPlaces.map((p) => p.name));

  // Get food preferences
  const likedFoods = await getNeighbors(userId, user.id, {
    direction: 'outbound',
    relationFilter: 'likes',
  });

  console.log('Liked foods:', likedFoods.map((f) => f.name));

  // Find family members
  const family = await getNeighbors(userId, user.id, {
    direction: 'both', // Both parent_of and married_to
  });

  console.log('Family members:', family.map((f) => f.name));

  // Get dietary restrictions from family
  const dietaryRestrictions = family
    .flatMap((member) => member.properties.dietary || [])
    .filter((v, i, a) => a.indexOf(v) === i); // Unique

  console.log('Family dietary restrictions:', dietaryRestrictions);

  return {
    visitedPlaces,
    likedFoods,
    family,
    dietaryRestrictions,
  };
}

// =====================================================
// EXAMPLE 4: Fuzzy Search for Entity Linking
// =====================================================

async function linkMentionToEntity(_mention: string) {
  // User writes: "Had dinner with Sarah at that Italian place"
  // Extract "Sarah" and "Italian place"

  // Find Sarah
  const sarahResults = await  getEntityByName(userId, 'Sarah', 'person', 0.6);

  if (sarahResults.length === 0) {
    // Create new entity
    const sarah = await createEntity(userId, {
      type: 'person',
      name: 'Sarah',
      origin: 'ai_inferred',
      agentSource: 'claude-desktop',
    });
    console.log('Created new entity:', sarah);
  } else if (sarahResults.length === 1) {
    // Exact match
    console.log('Matched entity:', sarahResults[0]);
  } else {
    // Ambiguous - need context to disambiguate
    // Check which Sarah has "dinner" or "restaurant" edges
    console.log('Multiple Sarahs found, disambiguating...');
    // Phase 3 will implement context-based disambiguation
  }

  // Find Italian place
  const placeResults = await  getEntityByName(
    userId,
    'Italian place',
    'place',
    0.4
  );

  if (placeResults.length > 0) {
    console.log('Matched Italian restaurant:', placeResults[0].name);
  }
}

// =====================================================
// EXAMPLE 5: Tracking Medication Routine
// =====================================================

async function trackMedication() {
  // Create medication entity
  const metformin = await createEntity(userId, {
    type: 'medication',
    name: 'Metformin',
    properties: {
      dose: '500mg',
      frequency: 'twice daily',
      condition: 'type 2 diabetes',
      prescriber: 'Dr. Johnson',
    },
    origin: 'user_stated',
  });

  // Link user to medication
  await createEdge(userId, {
    sourceId: 1, // User entity
    targetId: metformin.id,
    relation: 'takes',
    weight: 2.0, // High weight = regular medication
    evidence: [
      {
        type: 'table',
        table: 'medications',
        row_id: 1,
      },
    ],
    origin: 'user_stated',
  });

  // Each time user logs taking medication, reinforce the edge
  for (let day = 1; day <= 7; day++) {
    await createEdge(userId, {
      sourceId: 1,
      targetId: metformin.id,
      relation: 'takes', // Same relation = weight increment
      weight: 0.1,
      evidence: [
        {
          type: 'table',
          table: 'medication_log',
          row_id: day,
          date: `2026-02-${String(day).padStart(2, '0')}`,
        },
      ],
      origin: 'user_stated',
    });
  }

  const edge = await getNeighbors(userId, 1, {
    relationFilter: 'takes',
  });

  console.log('Medication edge weight after 7 days:', edge[0].edge.weight); // 2.7
  console.log('Evidence count:', edge[0].edge.evidence.length); // 8
}

// =====================================================
// EXAMPLE 6: Building Interest Graph
// =====================================================

async function buildInterestGraph() {
  // Create topics from reading history
  const topics = [
    { name: 'Machine Learning', interest: 'high' },
    { name: 'Photography', interest: 'medium' },
    { name: 'Cooking', interest: 'high' },
  ];

  for (const topic of topics) {
    const entity = await createEntity(userId, {
      type: 'topic',
      name: topic.name,
      properties: { interest_level: topic.interest },
      origin: 'ai_pattern',
    });

    await createEdge(userId, {
      sourceId: 1, // User
      targetId: entity.id,
      relation: 'interested_in',
      weight: topic.interest === 'high' ? 2.0 : 1.0,
      origin: 'ai_pattern',
    });
  }

  // Link related topics
  const ml = await  getEntityByName(userId, 'Machine Learning', 'topic');
  const photo = await  getEntityByName(userId, 'Photography', 'topic');

  if (ml.length && photo.length) {
    // User might be interested in computational photography
    await createEdge(userId, {
      sourceId: ml[0].id,
      targetId: photo[0].id,
      relation: 'related_to',
      weight: 0.5,
      properties: { reasoning: 'computational photography overlap' },
      origin: 'ai_pattern',
    });
  }
}

// Export examples for documentation
export const examples = {
  buildFamilyGraph,
  recordRestaurantVisit,
  getRecommendationContext,
  linkMentionToEntity,
  trackMedication,
  buildInterestGraph,
};
