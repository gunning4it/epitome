/**
 * Profile Service
 *
 * JSONB versioned profile management with append-only writes
 *
 * Features:
 * - RFC 7396 deep-merge for PATCH operations
 * - Version history tracking
 * - changed_fields tracking
 * - Integration with MemoryQualityService
 */

import { withUserSchema } from '@/db/client';
import {
  createMemoryMetaInternal,
  recordAccessInternal,
  recordMentionInternal,
  detectContradictionsInternal,
} from './memoryQuality.service';

/**
 * Profile data (flexible JSONB structure)
 */
export interface ProfileData {
  name?: string;
  timezone?: string;
  preferences?: {
    dietary?: string[];
    allergies?: string[];
    [key: string]: unknown;
  };
  family?: Array<{
    name: string;
    relation: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown; // Allow arbitrary fields
}

/**
 * Profile version entry
 */
export interface ProfileVersion {
  id: number;
  data: ProfileData;
  version: number;
  changedBy?: string;
  changedFields?: string[];
  changedAt: Date;
  metaId?: number;
}

/**
 * Profile response with version metadata
 */
export interface ProfileResponse {
  data: ProfileData;
  version: number;
  updated_at: string;
}

function getValueAtPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Get latest profile
 *
 * Returns the current profile with version metadata (highest version number)
 *
 * @param userId - User ID for schema isolation
 * @returns Current profile with version info, or null if no profile exists
 */
export async function getLatestProfile(
  userId: string
): Promise<ProfileResponse | null> {
  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT data, version, changed_at, _meta_id
      FROM profile
      ORDER BY version DESC
      LIMIT 1
    `
    );

    if (!rows[0]) return null;

    if (rows[0]._meta_id) {
      await recordAccessInternal(tx, rows[0]._meta_id as number);
    }

    return {
      data: rows[0].data as ProfileData,
      version: rows[0].version as number,
      updated_at: new Date(rows[0].changed_at as string).toISOString(),
    };
  });

  return result;
}

/**
 * Get profile version history
 *
 * Returns all profile versions in reverse chronological order
 *
 * @param userId - User ID for schema isolation
 * @param limit - Maximum number of versions to return (default 50)
 * @returns Array of profile versions
 */
export async function getProfileHistory(
  userId: string,
  limit: number = 50
): Promise<ProfileVersion[]> {
  return await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe<Record<string, unknown>[]>(
      `
      SELECT
        id,
        data,
        version,
        changed_by,
        changed_fields,
        changed_at,
        _meta_id
      FROM profile
      ORDER BY version DESC
      LIMIT $1
    `,
      [limit]
    );

    for (const row of rows) {
      if (row._meta_id) {
        await recordAccessInternal(tx, row._meta_id as number);
      }
    }

    return rows.map((row) => ({
      id: row.id as number,
      data: row.data as ProfileData,
      version: row.version as number,
      changedBy: row.changed_by as string | undefined,
      changedFields: (row.changed_fields || []) as string[],
      changedAt: new Date(row.changed_at as string),
      metaId: row._meta_id as number | undefined,
    }));
  });
}

/**
 * Get specific profile version
 *
 * @param userId - User ID for schema isolation
 * @param version - Version number to retrieve
 * @returns Profile version or null if not found
 */
export async function getProfileVersion(
  userId: string,
  version: number
): Promise<ProfileVersion | null> {
  const result = await withUserSchema(userId, async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT
        id,
        data,
        version,
        changed_by,
        changed_fields,
        changed_at,
        _meta_id
      FROM profile
      WHERE version = $1
      LIMIT 1
    `,
      [version]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    if (row._meta_id) {
      await recordAccessInternal(tx, row._meta_id as number);
    }
    return {
      id: row.id,
      data: row.data,
      version: row.version,
      changedBy: row.changed_by,
      changedFields: row.changed_fields || [],
      changedAt: new Date(row.changed_at),
      metaId: row._meta_id,
    };
  });

  return result;
}

/**
 * Deep merge objects (RFC 7396 JSON Merge Patch)
 *
 * Rules:
 * - null values remove keys
 * - Arrays are replaced (not merged)
 * - Objects are recursively merged
 *
 * @param target - Target object
 * @param patch - Patch to apply
 * @returns Merged object
 */
export function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      // null removes the key
      delete result[key];
    } else if (Array.isArray(value)) {
      // Arrays are replaced, not merged
      result[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      // Objects are recursively merged
      const targetValue = result[key];
      if (typeof targetValue === 'object' && targetValue !== null && !Array.isArray(targetValue)) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        result[key] = value;
      }
    } else {
      // Primitives replace
      result[key] = value;
    }
  }

  return result;
}

/**
 * Get changed fields between two objects
 *
 * Returns dotted paths of changed fields
 *
 * @param oldObj - Old object
 * @param newObj - New object
 * @param prefix - Prefix for nested paths
 * @returns Array of changed field paths
 */
function getChangedFields(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefix: string = ''
): string[] {
  const changed: string[] = [];

  // Check all keys in new object
  for (const key of Object.keys(newObj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldValue = oldObj[key];
    const newValue = newObj[key];

    if (newValue === null && oldValue !== undefined) {
      // Key was removed
      changed.push(path);
    } else if (Array.isArray(newValue)) {
      // Arrays - check if different
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changed.push(path);
      }
    } else if (typeof newValue === 'object' && newValue !== null) {
      // Objects - recurse
      if (typeof oldValue === 'object' && oldValue !== null && !Array.isArray(oldValue)) {
        const nested = getChangedFields(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          path
        );
        changed.push(...nested);
      } else {
        changed.push(path);
      }
    } else if (oldValue !== newValue) {
      // Primitives - check if different
      changed.push(path);
    }
  }

  // Check for removed keys (in old but not in new)
  for (const key of Object.keys(oldObj)) {
    if (!(key in newObj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      changed.push(path);
    }
  }

  return changed;
}

function collectPatchLeafPaths(
  patch: Record<string, unknown>,
  prefix: string = ''
): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null) continue;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      paths.push(...collectPatchLeafPaths(value as Record<string, unknown>, path));
      continue;
    }

    paths.push(path);
  }

  return paths;
}

function hasReaffirmedPatchValue(
  currentData: Record<string, unknown>,
  newData: Record<string, unknown>,
  patch: Record<string, unknown>
): boolean {
  const paths = collectPatchLeafPaths(patch);

  for (const path of paths) {
    const oldValue = getValueAtPath(currentData, path);
    const nextValue = getValueAtPath(newData, path);
    if (oldValue === undefined || nextValue === undefined) continue;
    if (JSON.stringify(oldValue) === JSON.stringify(nextValue)) {
      return true;
    }
  }

  return false;
}

/**
 * Identity violation detail
 */
export interface IdentityViolation {
  field: string;
  attemptedValue: unknown;
  reason: string;
  blocked: boolean;
}

/**
 * Check identity invariants before profile mutation.
 *
 * Rule: profile.name cannot be set to a known family member name/nickname
 * unless an explicit overrideReason is provided.
 *
 * @param currentData - Current profile data
 * @param patch - Proposed changes
 * @param changedBy - Who is making the change ('user', agent ID, etc.)
 * @param overrideReason - Optional reason to override the check
 * @returns Array of violations (empty if none)
 */
export function checkIdentityInvariants(
  currentData: ProfileData,
  patch: Partial<ProfileData>,
  changedBy: string,
  overrideReason?: string,
): IdentityViolation[] {
  const violations: IdentityViolation[] = [];

  // Only check name changes
  if (!patch.name || typeof patch.name !== 'string') return violations;

  // Build set of known family member names and nicknames
  const familyNames = new Set<string>();
  const family = currentData.family;

  if (family) {
    const members: Array<Record<string, unknown>> = [];

    if (Array.isArray(family)) {
      for (const m of family) {
        if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
      }
    } else if (typeof family === 'object') {
      for (const [, val] of Object.entries(family as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          for (const m of val) {
            if (m && typeof m === 'object') members.push(m as Record<string, unknown>);
          }
        } else if (val && typeof val === 'object') {
          members.push(val as Record<string, unknown>);
        }
      }
    }

    for (const member of members) {
      if (member.name && typeof member.name === 'string') {
        familyNames.add(member.name.toLowerCase());
        // Also add first name only
        const firstName = member.name.split(' ')[0];
        if (firstName) familyNames.add(firstName.toLowerCase());
      }
      if (member.nickname && typeof member.nickname === 'string') {
        familyNames.add(member.nickname.toLowerCase());
      }
    }
  }

  // Check if proposed name matches a family member
  const proposedNameLower = patch.name.toLowerCase().trim();
  if (familyNames.has(proposedNameLower)) {
    const blocked = changedBy !== 'user' && !overrideReason;
    violations.push({
      field: 'name',
      attemptedValue: patch.name,
      reason: `Cannot set profile name to "${patch.name}" — matches a known family member. This would corrupt the owner identity.`,
      blocked,
    });
  }

  return violations;
}

/**
 * Update profile (PATCH with deep merge)
 *
 * Applies RFC 7396 JSON Merge Patch to current profile
 * Creates new version (append-only, never UPDATE)
 *
 * @param userId - User ID for schema isolation
 * @param patch - Partial profile data to merge
 * @param changedBy - Who made the change (user, agent ID, etc.)
 * @param origin - Origin for memory quality ('user_typed', 'user_stated', etc.)
 * @returns New profile version
 */
export async function updateProfile(
  userId: string,
  patch: Partial<ProfileData>,
  changedBy: string = 'user',
  origin: string = 'user_typed'
): Promise<ProfileVersion> {
  return await withUserSchema(userId, async (tx) => {
    // Get current profile (inline query to avoid nested withUserSchema)
    const currentRows = await tx.unsafe(
      `SELECT data, _meta_id FROM profile ORDER BY version DESC LIMIT 1`
    );
    const currentData = (currentRows[0]?.data as ProfileData) || {};
    const previousMetaId = (currentRows[0]?._meta_id as number | undefined) || undefined;

    // Identity invariant check
    const violations = checkIdentityInvariants(
      currentData as ProfileData,
      patch as Partial<ProfileData>,
      changedBy,
    );
    const blockedViolations = violations.filter((v) => v.blocked);
    if (blockedViolations.length > 0) {
      throw new Error(
        `IDENTITY_VIOLATION: ${blockedViolations.map((v) => v.reason).join('; ')}`,
      );
    }

    // Apply deep merge
    const newData = deepMerge(
      currentData as Record<string, unknown>,
      patch as Record<string, unknown>
    ) as ProfileData;

    // Calculate changed fields
    const changedFields = getChangedFields(
      currentData as Record<string, unknown>,
      newData as Record<string, unknown>
    );

    // Get next version number
    const versionResult = await tx.unsafe(
      `SELECT MAX(version) as max_version FROM profile`
    );
    const nextVersion = (versionResult[0]?.max_version || 0) + 1;

    // Create memory metadata (use internal version to avoid nested withUserSchema)
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'profile',
      sourceRef: `v${nextVersion}`,
      origin,
      agentSource: changedBy !== 'user' ? changedBy : undefined,
    });

    // Insert new profile version
    const result = await tx.unsafe(
      `
      INSERT INTO profile (
        data,
        version,
        changed_by,
        changed_fields,
        changed_at,
        _meta_id
      ) VALUES (
        $1, $2, $3, $4, NOW(), $5
      )
      RETURNING id, data, version, changed_by, changed_fields, changed_at, _meta_id
    `,
      [
        JSON.stringify(newData),
        nextVersion,
        changedBy,
        JSON.stringify(changedFields),
        metaId,
      ]
    );

    const row = result[0];

    if (previousMetaId && changedFields.length > 0) {
      const comparisons: Array<{
        oldMetaId: number;
        field: string;
        oldValue: unknown;
        newValue: unknown;
        agent: string;
      }> = [];

      for (const fieldPath of changedFields) {
        const oldValue = getValueAtPath(currentData as Record<string, unknown>, fieldPath);
        const nextValue = getValueAtPath(newData as Record<string, unknown>, fieldPath);

        // New fields are not contradictions; only changed existing facts are.
        if (oldValue === undefined || nextValue === undefined) continue;
        if (JSON.stringify(oldValue) === JSON.stringify(nextValue)) continue;

        comparisons.push({
          oldMetaId: previousMetaId,
          field: `profile.${fieldPath}`,
          oldValue,
          newValue: nextValue,
          agent: changedBy,
        });
      }

      await detectContradictionsInternal(tx, metaId, comparisons);
    }

    if (
      previousMetaId &&
      hasReaffirmedPatchValue(
        currentData as Record<string, unknown>,
        newData as Record<string, unknown>,
        patch as Record<string, unknown>
      )
    ) {
      // Conservative reinforcement: one mention bump per reaffirming update request.
      await recordMentionInternal(tx, previousMetaId);
    }

    return {
      id: row.id,
      data: row.data,
      version: row.version,
      changedBy: row.changed_by,
      changedFields: row.changed_fields || [],
      changedAt: new Date(row.changed_at),
      metaId: row._meta_id,
    };
  });
}

/**
 * Initialize profile for new user
 *
 * Creates the first profile version with default data
 *
 * @param userId - User ID for schema isolation
 * @param initialData - Initial profile data
 * @returns Created profile version
 */
export async function initializeProfile(
  userId: string,
  initialData: Partial<ProfileData> = {}
): Promise<ProfileVersion> {
  return await updateProfile(userId, initialData, 'system', 'user_typed');
}

/**
 * Replace entire profile
 *
 * Creates a new version with completely new data (no merge)
 * Used for imports from Google/Apple
 *
 * @param userId - User ID for schema isolation
 * @param newData - Complete new profile data
 * @param changedBy - Who made the change
 * @param origin - Origin for memory quality
 * @returns New profile version
 */
export async function replaceProfile(
  userId: string,
  newData: ProfileData,
  changedBy: string = 'import',
  origin: string = 'imported'
): Promise<ProfileVersion> {
  return await withUserSchema(userId, async (tx) => {
    const currentRows = await tx.unsafe(
      `SELECT data, _meta_id FROM profile ORDER BY version DESC LIMIT 1`
    );
    const currentData = (currentRows[0]?.data as ProfileData) || {};
    const previousMetaId = (currentRows[0]?._meta_id as number | undefined) || undefined;

    // Get next version number
    const versionResult = await tx.unsafe(
      `SELECT MAX(version) as max_version FROM profile`
    );
    const nextVersion = (versionResult[0]?.max_version || 0) + 1;
    const changedFields = getChangedFields(
      currentData as Record<string, unknown>,
      newData as Record<string, unknown>
    );

    // Create memory metadata (use internal version to avoid nested withUserSchema)
    const metaId = await createMemoryMetaInternal(tx, {
      sourceType: 'profile',
      sourceRef: `v${nextVersion}`,
      origin,
      agentSource: changedBy !== 'user' && changedBy !== 'import' ? changedBy : undefined,
    });

    // Insert new profile version
    const result = await tx.unsafe(
      `
      INSERT INTO profile (
        data,
        version,
        changed_by,
        changed_fields,
        changed_at,
        _meta_id
      ) VALUES (
        $1, $2, $3, $4, NOW(), $5
      )
      RETURNING id, data, version, changed_by, changed_fields, changed_at, _meta_id
    `,
      [
        JSON.stringify(newData),
        nextVersion,
        changedBy,
        JSON.stringify(changedFields),
        metaId,
      ]
    );

    const row = result[0];

    if (previousMetaId && changedFields.length > 0) {
      const comparisons: Array<{
        oldMetaId: number;
        field: string;
        oldValue: unknown;
        newValue: unknown;
        agent: string;
      }> = [];

      for (const fieldPath of changedFields) {
        const oldValue = getValueAtPath(currentData as Record<string, unknown>, fieldPath);
        const nextValue = getValueAtPath(newData as Record<string, unknown>, fieldPath);

        if (oldValue === undefined || nextValue === undefined) continue;
        if (JSON.stringify(oldValue) === JSON.stringify(nextValue)) continue;

        comparisons.push({
          oldMetaId: previousMetaId,
          field: `profile.${fieldPath}`,
          oldValue,
          newValue: nextValue,
          agent: changedBy,
        });
      }

      await detectContradictionsInternal(tx, metaId, comparisons);
    }

    return {
      id: row.id,
      data: row.data,
      version: row.version,
      changedBy: row.changed_by,
      changedFields: row.changed_fields || [],
      changedAt: new Date(row.changed_at),
      metaId: row._meta_id,
    };
  });
}

/**
 * Validate profile data
 *
 * Basic validation for profile structure
 *
 * @param data - Profile data to validate
 * @throws Error if validation fails
 */
export function validateProfile(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    throw new Error('PROFILE_VALIDATION_ERROR: Profile must be an object');
  }

  // Check for maximum nesting depth (prevent deeply nested objects)
  const maxDepth = 10;

  function checkDepth(obj: unknown, depth: number = 0): void {
    if (depth > maxDepth) {
      throw new Error(
        `PROFILE_VALIDATION_ERROR: Profile exceeds maximum nesting depth of ${maxDepth}`
      );
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) {
        checkDepth(value, depth + 1);
      }
    }
  }

  checkDepth(data);

  // Check serialized size (prevent extremely large profiles)
  const serialized = JSON.stringify(data);
  const maxSize = 1024 * 1024; // 1MB

  if (serialized.length > maxSize) {
    throw new Error(
      `PROFILE_VALIDATION_ERROR: Profile exceeds maximum size of ${maxSize} bytes`
    );
  }
}
