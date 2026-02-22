/**
 * Consent Service
 *
 * Per-agent permission management for resources
 *
 * Features:
 * - Wildcard pattern matching (tables/*, vectors/*)
 * - Most specific rule wins
 * - Deny by default
 * - Audit trail integration
 */

import { withUserSchema } from '@/db/client';
import { logAuditEntry } from './audit.service';
import { logger } from '@/utils/logger';
import { revokeApiKeysForAgent, deleteApiKeysForAgent, deleteAgentRegistryEntry } from './auth.service';

/**
 * Permission levels
 */
export type Permission = 'read' | 'write' | 'none';

/**
 * Consent rule
 */
export interface ConsentRule {
  id?: string;
  agentId: string;
  resource: string; // 'profile', 'tables/meals', 'tables/*', 'vectors/*', 'graph'
  permission: Permission;
  grantedAt?: Date;
  revokedAt?: Date | null;
}

/** Raw row from consent_rules query */
interface ConsentRuleRow {
  id: string;
  agent_id: string;
  resource: string;
  permission: string;
  granted_at: string;
  revoked_at: string | null;
}

/**
 * Check if agent has permission for a resource
 *
 * Rules:
 * - Most specific pattern wins (ORDER BY LENGTH(resource) DESC)
 * - No rule = no access (deny by default)
 * - Logs permission check to audit trail
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID to check
 * @param resource - Resource path (e.g., 'tables/meals', 'profile')
 * @param permission - Permission level to check ('read' or 'write')
 * @returns True if agent has permission
 */
export async function checkConsent(
  userId: string,
  agentId: string,
  resource: string,
  permission: Permission
): Promise<boolean> {
  logger.debug('checkConsent START', { userId, agentId, resource });

  const hasPermission = await withUserSchema(userId, async (tx) => {
    logger.debug('Inside withUserSchema, executing query');

    // Query for matching rules, ordered by specificity (most specific first)
    // Wildcard matching: tables/* matches tables/meals, tables/workouts, etc.
    // H-6 SECURITY FIX: Escape LIKE metacharacters (%, _, \) in the stored resource
    // pattern before converting * wildcards to %, so literal % and _ in resource
    // names don't match arbitrary characters.
    const result = await tx.unsafe(
      `
      SELECT permission
      FROM consent_rules
      WHERE agent_id = $1
        AND revoked_at IS NULL
        AND (
          resource = $2  -- Exact match
          OR $2 LIKE REPLACE(
            REPLACE(REPLACE(REPLACE(resource, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%',
            '*', '%'
          ) ESCAPE E'\\\\'  -- Wildcard match with escaped LIKE metacharacters
        )
      ORDER BY LENGTH(resource) DESC  -- Most specific rule wins
      LIMIT 1
    `,
      [agentId, resource]
    );

    logger.debug('Consent query returned', { resultCount: result.length });

    if (result.length === 0) {
      logger.debug('No consent rule found - denying by default');
      return false;
    }

    const rule = result[0];

    logger.debug('Found consent rule', { permission: rule.permission });

    // Check if permission level is sufficient
    if (permission === 'read') {
      // For read, both 'read' and 'write' permissions work
      return rule.permission === 'read' || rule.permission === 'write';
    } else if (permission === 'write') {
      // For write, only 'write' permission works
      return rule.permission === 'write';
    }

    return false;
  });

  logger.debug('checkConsent completed', { hasPermission });

  // Log permission check to audit trail (non-fatal — consent decision already made)
  try {
    await logAuditEntry(userId, {
      agentId,
      action: 'consent_check',
      resource,
      details: {
        permission,
        granted: hasPermission,
      },
    });
  } catch (err) {
    logger.error('Failed to log consent check audit entry', { error: String(err) });
  }

  return hasPermission;
}

/**
 * Grant permission to an agent for a resource
 *
 * @param userId - User ID for schema isolation
 * @param rule - Consent rule to create
 */
export async function grantConsent(
  userId: string,
  rule: ConsentRule
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    // Upsert: handles new rules, permission changes, AND re-granting revoked rules
    // Use ON CONFLICT ON CONSTRAINT for explicit constraint matching
    await tx.unsafe(
      `
      INSERT INTO consent_rules (agent_id, resource, permission, granted_at, revoked_at)
      VALUES ($1, $2, $3, NOW(), NULL)
      ON CONFLICT ON CONSTRAINT consent_rules_agent_id_resource_key DO UPDATE SET
        permission = EXCLUDED.permission,
        granted_at = NOW(),
        revoked_at = NULL
    `,
      [rule.agentId, rule.resource, rule.permission]
    );
  });

  // Log to audit trail (non-fatal — consent already committed)
  try {
    await logAuditEntry(userId, {
      agentId: rule.agentId,
      action: 'consent_granted',
      resource: rule.resource,
      details: {
        permission: rule.permission,
      },
    });
  } catch (err) {
    logger.error('Failed to log consent audit entry', { error: String(err) });
  }
}

/**
 * Revoke permission from an agent for a resource
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID
 * @param resource - Resource path
 */
export async function revokeConsent(
  userId: string,
  agentId: string,
  resource: string
): Promise<void> {
  await withUserSchema(userId, async (tx) => {
    await tx.unsafe(
      `
      UPDATE consent_rules
      SET revoked_at = NOW()
      WHERE agent_id = $1
        AND resource = $2
        AND revoked_at IS NULL
    `,
      [agentId, resource]
    );
  });

  // Log to audit trail (non-fatal — consent already committed)
  try {
    await logAuditEntry(userId, {
      agentId,
      action: 'consent_revoked',
      resource,
      details: {},
    });
  } catch (err) {
    logger.error('Failed to log consent audit entry', { error: String(err) });
  }
}

/**
 * Get all consent rules for an agent
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID
 * @returns Array of consent rules
 */
export async function getAgentConsent(
  userId: string,
  agentId: string
): Promise<ConsentRule[]> {
  return await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<ConsentRuleRow[]>(
      `
      SELECT
        id::text,
        agent_id,
        resource,
        permission,
        granted_at,
        revoked_at
      FROM consent_rules
      WHERE agent_id = $1
        AND revoked_at IS NULL
      ORDER BY resource
    `,
      [agentId]
    );

    return result.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      resource: row.resource,
      permission: row.permission as Permission,
      grantedAt: new Date(row.granted_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    }));
  });
}

/**
 * Get all agents with access to a resource
 *
 * @param userId - User ID for schema isolation
 * @param resource - Resource path
 * @returns Array of agent IDs with their permissions
 */
export async function getResourceConsent(
  userId: string,
  resource: string
): Promise<Array<{ agentId: string; permission: Permission }>> {
  return await withUserSchema(userId, async (tx) => {
    const result = await tx.unsafe<{ agent_id: string; permission: string }[]>(
      `
      SELECT DISTINCT ON (agent_id)
        agent_id,
        permission
      FROM consent_rules
      WHERE revoked_at IS NULL
        AND (
          resource = $1
          OR $1 LIKE REPLACE(
            REPLACE(REPLACE(REPLACE(resource, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%',
            '*', '%'
          ) ESCAPE E'\\\\'
        )
      ORDER BY agent_id, LENGTH(resource) DESC
    `,
      [resource]
    );

    return result.map((row) => ({
      agentId: row.agent_id,
      permission: row.permission as Permission,
    }));
  });
}

/**
 * Revoke all permissions for an agent
 *
 * Used when disconnecting an agent from the user's account
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID
 */
export async function revokeAllAgentConsent(
  userId: string,
  agentId: string
): Promise<void> {
  // Revoke API keys first so the agent is immediately blocked at the auth layer
  await revokeApiKeysForAgent(userId, agentId);

  await withUserSchema(userId, async (tx) => {
    await tx.unsafe(
      `
      UPDATE consent_rules
      SET revoked_at = NOW()
      WHERE agent_id = $1
        AND revoked_at IS NULL
    `,
      [agentId]
    );
  });

  // Log to audit trail (non-fatal — consent already committed)
  try {
    await logAuditEntry(userId, {
      agentId,
      action: 'all_consent_revoked',
      resource: '*',
      details: {},
    });
  } catch (err) {
    logger.error('Failed to log consent audit entry', { error: String(err) });
  }
}

/**
 * Delete all data for an agent
 *
 * Hard-deletes consent rules, API keys, and agent registry entry.
 * Agent must have all keys revoked first.
 *
 * @param userId - User ID for schema isolation
 * @param agentId - Agent ID
 */
export async function deleteAllAgentData(
  userId: string,
  agentId: string
): Promise<void> {
  // Delete consent rules from user schema
  await withUserSchema(userId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM consent_rules WHERE agent_id = $1`,
      [agentId]
    );
  });

  // Delete API keys and agent registry entry from public schema
  await deleteApiKeysForAgent(userId, agentId);
  await deleteAgentRegistryEntry(userId, agentId);

  // Log to audit trail (non-fatal)
  try {
    await logAuditEntry(userId, {
      agentId,
      action: 'agent_deleted',
      resource: '*',
      details: {},
    });
  } catch (err) {
    logger.error('Failed to log agent deletion audit entry', { error: String(err) });
  }
}

/**
 * Require consent middleware helper
 *
 * Throws an error if agent doesn't have permission
 *
 * @param userId - User ID
 * @param agentId - Agent ID
 * @param resource - Resource path
 * @param permission - Required permission level
 * @throws Error if permission denied
 */
export async function requireConsent(
  userId: string,
  agentId: string,
  resource: string,
  permission: Permission
): Promise<void> {
  const hasPermission = await checkConsent(userId, agentId, resource, permission);

  if (!hasPermission) {
    throw new Error(
      `CONSENT_DENIED: Agent '${agentId}' does not have ${permission} access to ${resource}`
    );
  }
}

export type ConsentDomain = 'profile' | 'tables' | 'vectors' | 'graph' | 'memory';

const DOMAIN_RESOURCES: Record<ConsentDomain, string[]> = {
  profile: ['profile'],
  tables: ['tables', 'tables/*'],
  vectors: ['vectors', 'vectors/*'],
  graph: ['graph', 'graph/*'],
  memory: ['memory'],
};

/**
 * Domain-level consent check that treats root + wildcard resources as equivalent
 * for the same domain (e.g. tables and tables/*).
 */
export async function checkDomainConsent(
  userId: string,
  agentId: string,
  domain: ConsentDomain,
  permission: Permission
): Promise<boolean> {
  const resources = DOMAIN_RESOURCES[domain];
  for (const resource of resources) {
    if (await checkConsent(userId, agentId, resource, permission)) {
      return true;
    }
  }
  return false;
}

/**
 * Require domain-level consent. Accepts either root or wildcard grant
 * for domains that support wildcards.
 */
export async function requireDomainConsent(
  userId: string,
  agentId: string,
  domain: ConsentDomain,
  permission: Permission
): Promise<void> {
  const hasPermission = await checkDomainConsent(userId, agentId, domain, permission);
  if (!hasPermission) {
    const acceptable = DOMAIN_RESOURCES[domain].join(' or ');
    throw new Error(
      `CONSENT_DENIED: Agent '${agentId}' does not have ${permission} access to ${domain} (${acceptable})`,
    );
  }
}
