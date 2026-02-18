-- Merge duplicate "user" entities with the named owner entity
--
-- Problem: entityExtraction.ts created entities with name='user' AND separate
-- entities with the real user name (e.g. "Josh Gunning") with is_owner=true.
-- All edges point to "user" while the named entity is isolated.
--
-- Fix: For each user schema, reassign edges from the generic "user" entity
-- to the named owner entity, then soft-delete the generic "user" entity.

DO $$
DECLARE
  user_schema TEXT;
  owner_id INTEGER;
  generic_id INTEGER;
BEGIN
  -- Loop through all user schemas
  FOR user_schema IN
    SELECT schema_name FROM public.users WHERE schema_name LIKE 'user_%'
  LOOP
    -- Find the named owner entity (is_owner = true, name != 'user')
    EXECUTE format(
      $q$
        SELECT id FROM %I.entities
        WHERE type = 'person'
          AND (properties->>'is_owner')::boolean = true
          AND lower(name) != 'user'
          AND _deleted_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      $q$, user_schema
    ) INTO owner_id;

    -- Find the generic "user" entity
    EXECUTE format(
      $q$
        SELECT id FROM %I.entities
        WHERE type = 'person'
          AND lower(name) = 'user'
          AND _deleted_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      $q$, user_schema
    ) INTO generic_id;

    -- Only merge if both exist and are different
    IF owner_id IS NOT NULL AND generic_id IS NOT NULL AND owner_id != generic_id THEN
      -- Reassign edges where generic "user" is the source
      EXECUTE format(
        $q$
          UPDATE %I.edges
          SET source_id = $1
          WHERE source_id = $2
            AND _deleted_at IS NULL
        $q$, user_schema
      ) USING owner_id, generic_id;

      -- Reassign edges where generic "user" is the target
      EXECUTE format(
        $q$
          UPDATE %I.edges
          SET target_id = $1
          WHERE target_id = $2
            AND _deleted_at IS NULL
        $q$, user_schema
      ) USING owner_id, generic_id;

      -- Transfer mention count to owner entity
      EXECUTE format(
        $q$
          UPDATE %I.entities
          SET mention_count = mention_count + (
            SELECT mention_count FROM %I.entities WHERE id = $2
          )
          WHERE id = $1
        $q$, user_schema, user_schema
      ) USING owner_id, generic_id;

      -- Soft-delete the generic "user" entity
      EXECUTE format(
        $q$
          UPDATE %I.entities
          SET _deleted_at = NOW()
          WHERE id = $1
        $q$, user_schema
      ) USING generic_id;

      RAISE NOTICE 'Schema %: merged entity % (user) into % (owner)', user_schema, generic_id, owner_id;
    ELSIF generic_id IS NOT NULL AND owner_id IS NULL THEN
      -- No named owner exists — rename "user" to have is_owner property
      -- (The code will fix the name on next profile extraction)
      EXECUTE format(
        $q$
          UPDATE %I.entities
          SET properties = properties || '{"is_owner": true}'::jsonb
          WHERE id = $1
            AND _deleted_at IS NULL
        $q$, user_schema
      ) USING generic_id;

      RAISE NOTICE 'Schema %: marked entity % (user) as owner', user_schema, generic_id;
    END IF;
  END LOOP;
END $$;
