-- Ensure audit_log action CHECK constraint includes write pipeline events.
-- Applies to all existing user schemas and provides a reusable bootstrap helper.

CREATE OR REPLACE FUNCTION public.ensure_user_audit_log_actions(
  p_schema_name VARCHAR
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema_name IS NULL OR p_schema_name !~ '^user_[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid user schema: %', p_schema_name;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check',
    p_schema_name
  );

  EXECUTE format(
    $fmt$ALTER TABLE %I.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
      'read','write','update','delete','search','query',
      'graph_query','profile_read','profile_write','write_pipeline',
      'consent_check','consent_granted','consent_revoked',
      'all_consent_revoked','revoke_all_consent',
      'mcp_get_user_context','mcp_save_memory','mcp_search_memory',
      'mcp_query_graph','mcp_query_table','mcp_add_record',
      'mcp_list_tables','mcp_update_profile','mcp_review_memories'
    ))$fmt$,
    p_schema_name
  );
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schema_name
    FROM public.users
    WHERE schema_name ~ '^user_[a-z0-9]+$'
  LOOP
    PERFORM public.ensure_user_audit_log_actions(r.schema_name);
  END LOOP;
END;
$$;
