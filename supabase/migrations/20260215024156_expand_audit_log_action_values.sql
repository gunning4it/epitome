-- Expand audit_log action CHECK constraint to include ALL action values
-- used in the codebase: REST route actions, MCP tool actions, consent actions.
-- Operates on the parent audit_log table — cascades to all partitions.

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
        -- REST route actions
        '''read'',''write'',''update'',''delete'',''search'',''query'','
        '''graph_query'',''profile_read'',''profile_write'','
        -- Consent actions
        '''consent_check'',''consent_granted'',''consent_revoked'','
        '''all_consent_revoked'',''revoke_all_consent'','
        -- MCP tool actions
        '''mcp_get_user_context'',''mcp_save_memory'',''mcp_search_memory'','
        '''mcp_query_graph'',''mcp_query_table'',''mcp_add_record'','
        '''mcp_list_tables'',''mcp_update_profile'',''mcp_review_memories'''
      '))',
      schema_name
    );
  END LOOP;
END;
$$;
