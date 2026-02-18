-- Fix audit_log CHECK constraint — idempotent re-apply on parent table.
-- PostgreSQL partitions INHERIT CHECK constraints from the parent, so
-- dropping + re-adding on audit_log cascades to all partitions automatically.
-- Previous migration (20260215020529) did this, but re-applying is safe
-- and ensures partitions are definitively updated.

DO $$
DECLARE
  schema_name TEXT;
BEGIN
  FOR schema_name IN
    SELECT nspname FROM pg_namespace WHERE nspname LIKE 'user_%'
  LOOP
    -- Drop and re-add on parent — automatically cascades to all partitions
    EXECUTE format(
      'ALTER TABLE %I.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check',
      schema_name
    );
    EXECUTE format(
      'ALTER TABLE %I.audit_log ADD CONSTRAINT audit_log_action_check '
      'CHECK (action IN ('
        '''read'',''write'',''update'',''delete'',''search'','
        '''graph_query'',''profile_read'',''profile_write'','
        '''consent_check'',''consent_granted'',''consent_revoked'',''all_consent_revoked'''
      '))',
      schema_name
    );
  END LOOP;
END;
$$;
