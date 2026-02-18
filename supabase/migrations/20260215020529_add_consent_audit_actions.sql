-- Add consent audit actions to audit_log CHECK constraint
-- for all existing user schemas

DO $$
DECLARE
  schema_name TEXT;
BEGIN
  FOR schema_name IN
    SELECT nspname FROM pg_namespace WHERE nspname LIKE 'user_%'
  LOOP
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
