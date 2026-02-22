-- Backfill root-domain consent rules from active wildcard grants.
-- This keeps existing agents compatible when older checks request
-- root resources (tables, vectors, graph) while grants were stored
-- as domain wildcards (tables/*, vectors/*, graph/*).

DO $$
DECLARE
  schema_name TEXT;
BEGIN
  FOR schema_name IN
    SELECT s.schema_name
    FROM information_schema.schemata s
    WHERE s.schema_name LIKE 'user\_%' ESCAPE '\'
      AND s.schema_name NOT LIKE 'user\_template%' ESCAPE '\'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = schema_name
        AND t.table_name = 'consent_rules'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $sql$
      INSERT INTO %I.consent_rules (agent_id, resource, permission, granted_at, revoked_at)
      SELECT w.agent_id, 'tables', w.permission, NOW(), NULL
      FROM %I.consent_rules w
      WHERE w.resource = 'tables/*'
        AND w.revoked_at IS NULL
        AND w.permission IN ('read', 'write')
      ON CONFLICT (agent_id, resource)
      DO UPDATE
      SET permission = EXCLUDED.permission,
          granted_at = NOW(),
          revoked_at = NULL
      WHERE consent_rules.revoked_at IS NOT NULL
      $sql$,
      schema_name,
      schema_name
    );

    EXECUTE format(
      $sql$
      INSERT INTO %I.consent_rules (agent_id, resource, permission, granted_at, revoked_at)
      SELECT w.agent_id, 'vectors', w.permission, NOW(), NULL
      FROM %I.consent_rules w
      WHERE w.resource = 'vectors/*'
        AND w.revoked_at IS NULL
        AND w.permission IN ('read', 'write')
      ON CONFLICT (agent_id, resource)
      DO UPDATE
      SET permission = EXCLUDED.permission,
          granted_at = NOW(),
          revoked_at = NULL
      WHERE consent_rules.revoked_at IS NOT NULL
      $sql$,
      schema_name,
      schema_name
    );

    EXECUTE format(
      $sql$
      INSERT INTO %I.consent_rules (agent_id, resource, permission, granted_at, revoked_at)
      SELECT w.agent_id, 'graph', w.permission, NOW(), NULL
      FROM %I.consent_rules w
      WHERE w.resource = 'graph/*'
        AND w.revoked_at IS NULL
        AND w.permission IN ('read', 'write')
      ON CONFLICT (agent_id, resource)
      DO UPDATE
      SET permission = EXCLUDED.permission,
          granted_at = NOW(),
          revoked_at = NULL
      WHERE consent_rules.revoked_at IS NOT NULL
      $sql$,
      schema_name,
      schema_name
    );
  END LOOP;
END $$;
