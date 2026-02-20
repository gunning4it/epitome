// GENERATED FROM api/src/services/ontology.ts — do not edit directly

export const ENTITY_TYPES = [
  'person',
  'organization',
  'place',
  'food',
  'topic',
  'preference',
  'event',
  'activity',
  'medication',
  'media',
  'custom',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_DISPLAY: Record<EntityType, { label: string; color: string }> = {
  person:       { label: 'Person',       color: '#3b82f6' },
  organization: { label: 'Organization', color: '#8b5cf6' },
  place:        { label: 'Place',        color: '#10b981' },
  food:         { label: 'Food',         color: '#84cc16' },
  topic:        { label: 'Topic',        color: '#06b6d4' },
  preference:   { label: 'Preference',   color: '#ec4899' },
  event:        { label: 'Event',        color: '#f59e0b' },
  activity:     { label: 'Activity',     color: '#14b8a6' },
  medication:   { label: 'Medication',   color: '#ef4444' },
  media:        { label: 'Media',        color: '#a855f7' },
  custom:       { label: 'Custom',       color: '#78716c' },
};
