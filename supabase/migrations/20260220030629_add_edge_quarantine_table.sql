-- Add edge_quarantine table to each user schema.
-- Holds edges that failed validation during entity extraction.

CREATE OR REPLACE FUNCTION public.ensure_user_edge_quarantine_table(
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
    'CREATE TABLE IF NOT EXISTS %I.edge_quarantine (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(50),
      target_type VARCHAR(50),
      relation VARCHAR(100),
      source_name VARCHAR(500),
      target_name VARCHAR(500),
      reason TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )',
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
    PERFORM public.ensure_user_edge_quarantine_table(r.schema_name);
  END LOOP;
END;
$$;
