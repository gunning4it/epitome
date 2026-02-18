/**
 * MCP Tool: update_profile
 *
 * Update user profile with deep-merge (RFC 7396)
 */

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestProfileUpdate, ingestMemoryText } from '@/services/writeIngestion.service';
import { withUserSchema } from '@/db/client';
import { logger } from '@/utils/logger';
import type { McpContext } from '../server.js';
import type { ProfileData } from '@/services/profile.service';

interface UpdateProfileArgs {
  data: ProfileData;
  reason?: string;
}

export async function updateProfile(args: UpdateProfileArgs, context: McpContext) {
  const { userId, agentId } = context;

  // Consent check
  await requireConsent(userId, agentId, 'profile', 'write');

  // Audit log
  await logAuditEntry(userId, {
    agentId,
    action: 'mcp_update_profile',
    resource: 'profile',
    details: {
      reason: args.reason,
      changedFields: Object.keys(args.data),
    },
  });

  // Update profile
  const writeId = createWriteId();
  const ingested = await ingestProfileUpdate({
    userId,
    patch: args.data,
    changedBy: agentId,
    origin: 'ai_stated',
    writeId,
  });
  const updatedProfile = ingested.profile;

  // Auto-save profile summary as searchable memory (non-blocking)
  const changedFields = Object.keys(args.data);
  const summaryParts: string[] = [];
  for (const field of changedFields) {
    const val = args.data[field as keyof ProfileData];
    summaryParts.push(`${field}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
  }
  const summaryText = `Profile updated: ${summaryParts.join(', ')}`;

  void ingestMemoryText({
    userId,
    collection: 'profile',
    text: summaryText,
    metadata: {
      source: 'update_profile',
      agent: agentId,
      changed_fields: changedFields,
      reason: args.reason,
    },
    changedBy: agentId,
    origin: 'ai_stated',
    sourceRefHint: ingested.sourceRef,
    writeId,
  }).catch((err) =>
    logger.warn('Profile auto-vectorize failed', { error: String(err) })
  );

  // Update the "user" node name if profile has a name
  if (updatedProfile.data.name) {
    withUserSchema(userId, async (tx) => {
      await tx.unsafe(`
        UPDATE entities
        SET name = $1, last_seen = NOW()
        WHERE type = 'person'
          AND (properties->>'is_owner')::boolean = true
          AND _deleted_at IS NULL
      `, [updatedProfile.data.name]);
    }).catch((err) =>
      logger.warn('User entity name update failed', { error: String(err) })
    );
  }

  return {
    success: true,
    profile: updatedProfile,
    sourceRef: ingested.sourceRef,
    writeId: ingested.writeId,
    writeStatus: ingested.writeStatus,
    jobId: ingested.jobId,
    message: args.reason || 'Profile updated successfully',
  };
}
