-- Phase 2: Add GIN index on entities.properties for alias/nickname JSONB lookups
-- This accelerates the getEntityByName alias matching query that checks
-- properties->'aliases' using jsonb_array_elements_text.
--
-- Per-user schema architecture: entities table lives in user_xxx schemas,
-- so we iterate all existing user schemas and create the index in each.
-- New users already get this index via create_user_schema() in init.sql.

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
    -- Only apply if the entities table exists in this schema
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = schema_name
        AND t.table_name = 'entities'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_entities_properties_gin ON %I.entities USING gin (properties jsonb_path_ops)',
        schema_name
      );
      RAISE NOTICE 'Created GIN index on %.entities.properties', schema_name;
    END IF;
  END LOOP;
END $$;
