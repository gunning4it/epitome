-- Harden SECURITY DEFINER functions with explicit search_path
ALTER FUNCTION public.ensure_user_knowledge_ledger_tables(VARCHAR)
  SET search_path = public;

ALTER FUNCTION public.ensure_user_audit_log_actions(VARCHAR)
  SET search_path = public;
