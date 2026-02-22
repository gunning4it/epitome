// api/src/services/tools/updateProfile.ts

import { requireConsent } from '@/services/consent.service';
import { logAuditEntry } from '@/services/audit.service';
import { createWriteId, ingestProfileUpdate, ingestMemoryText } from '@/services/writeIngestion.service';
import { withUserSchema } from '@/db/client';
import { logger } from '@/utils/logger';
import { getLatestProfile, checkIdentityInvariants, type ProfileData } from '@/services/profile.service';
import type { ToolContext, ToolResult } from './types.js';
import { toolSuccess, toolFailure, ToolErrorCode } from './types.js';

interface UpdateProfileArgs {
  data: ProfileData;
  reason?: string;
}

export async function updateProfile(
  args: UpdateProfileArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { userId, agentId } = ctx;

  // Consent check
  try {
    await requireConsent(userId, agentId, 'profile', 'write');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('CONSENT_DENIED')) {
      return toolFailure(ToolErrorCode.CONSENT_DENIED, msg, false);
    }
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }

  // Identity invariant check (pre-check before ingestion)
  try {
    let currentProfileData: Record<string, unknown> = {};
    try {
      const currentProfile = await getLatestProfile(userId);
      currentProfileData = (currentProfile?.data || {}) as Record<string, unknown>;
    } catch {
      // Profile may not exist yet — skip identity check
    }

    const violations = checkIdentityInvariants(
      currentProfileData as ProfileData,
      args.data,
      agentId,
      args.reason,
    );
    const blockedViolations = violations.filter((v) => v.blocked);
    if (blockedViolations.length > 0) {
      await logAuditEntry(userId, {
        agentId,
        action: 'identity_violation_blocked',
        resource: 'profile',
        details: { violations: blockedViolations },
      });
      return toolFailure(
        ToolErrorCode.INVALID_ARGS,
        `IDENTITY_VIOLATION: ${blockedViolations.map((v) => v.reason).join('; ')}`,
        false,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Identity check failed', { error: msg, userId });
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }

  try {
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

    // Update the "user" node name if profile has a name (and identity check passed)
    if (updatedProfile.data.name) {
      // Log the owner entity rename for audit trail
      void logAuditEntry(userId, {
        agentId,
        action: 'owner_entity_rename',
        resource: 'profile',
        details: {
          newName: updatedProfile.data.name,
          changedBy: agentId,
        },
      }).catch(() => {});

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

    return toolSuccess(
      {
        success: true,
        profile: updatedProfile,
        sourceRef: ingested.sourceRef,
        writeId: ingested.writeId,
        writeStatus: ingested.writeStatus,
        jobId: ingested.jobId,
        message: args.reason || 'Profile updated successfully',
      },
      args.reason || 'Profile updated successfully',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('updateProfile service error', { error: msg, userId });
    return toolFailure(ToolErrorCode.INTERNAL_ERROR, msg, true);
  }
}
