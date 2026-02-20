/**
 * Profile Sync Service
 *
 * Projection layer: syncs entity/edge data back to the user profile.
 * When a works_at or attended edge is created, the corresponding
 * profile fields (work.company, work.role, education.institution)
 * are updated — unless a higher-precedence source already set them.
 *
 * Guardrails:
 * - Only fires for owner edges (not sourceRef edges)
 * - Respects source precedence: user_typed > ai_inferred
 * - Fire-and-forget: failures are logged but don't break extraction
 */

import { withUserSchema } from '@/db/client';
import { updateProfile, type ProfileData } from './profile.service';
import type { EntityType } from './ontology';
import { logger } from '@/utils/logger';

export async function syncEntityToProfile(
  userId: string,
  entity: { name: string; type: EntityType; properties?: Record<string, any> },
  edgeRelation: string,
  edgeProperties: Record<string, any>,
  isOwnerEdge: boolean,
): Promise<void> {
  if (!isOwnerEdge) return;

  const patch = buildProfilePatch(entity, edgeRelation, edgeProperties);
  if (!patch) return;

  try {
    // Fetch current profile data and changed_by in one query
    const current = await withUserSchema(userId, async (tx) => {
      const rows = await tx.unsafe(
        `SELECT data, changed_by FROM profile ORDER BY version DESC LIMIT 1`
      );
      if (!rows[0]) return null;
      return {
        data: rows[0].data as ProfileData,
        changedBy: rows[0].changed_by as string | undefined,
      };
    });

    if (shouldSkipSync(current?.data, patch, current?.changedBy)) {
      logger.info('Profile sync skipped: higher precedence source', {
        userId, edgeRelation, entity: entity.name,
      });
      return;
    }

    await updateProfile(userId, patch, 'system:entity_sync', 'ai_inferred');
    logger.info('Profile synced from entity', {
      userId, entity: entity.name, relation: edgeRelation,
    });
  } catch (err) {
    logger.warn('Profile sync failed', { error: String(err), userId, entity: entity.name });
  }
}

function buildProfilePatch(
  entity: { name: string; type: EntityType; properties?: Record<string, any> },
  relation: string,
  edgeProps: Record<string, any>,
): Partial<ProfileData> | null {
  if (relation === 'works_at' && entity.type === 'organization') {
    return {
      work: {
        company: entity.name,
        ...(edgeProps.role ? { role: edgeProps.role } : {}),
      },
    } as Partial<ProfileData>;
  }

  if (relation === 'attended' && entity.type === 'organization'
      && entity.properties?.category === 'education') {
    return {
      education: { institution: entity.name },
    } as Partial<ProfileData>;
  }

  return null;
}

function shouldSkipSync(
  currentData: ProfileData | undefined,
  patch: Partial<ProfileData>,
  lastChangedBy: string | undefined,
): boolean {
  if (!currentData) return false;

  // Don't overwrite data set by a higher-precedence source
  // system:entity_sync is ai_inferred precedence (30)
  // Any manual user edit (user_typed: 100) or user_stated (90) wins
  const isSystemSync = lastChangedBy === 'system:entity_sync';
  const patchData = patch as Record<string, any>;

  if (patchData.work?.company && (currentData as Record<string, any>).work?.company
      && !isSystemSync) {
    return true;
  }
  if (patchData.work?.role && (currentData as Record<string, any>).work?.role
      && !isSystemSync) {
    return true;
  }
  if (patchData.education?.institution && (currentData as Record<string, any>).education?.institution
      && !isSystemSync) {
    return true;
  }

  return false;
}
