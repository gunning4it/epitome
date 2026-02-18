-- Method B batch extraction support function
-- Queues enrichment jobs for records that are not yet queued/processed.

CREATE OR REPLACE FUNCTION public.epitome_batch_extract_entities(
  p_user_schema TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_table RECORD;
  v_inserted INTEGER := 0;
  v_total INTEGER := 0;
  v_sql TEXT;
BEGIN
  IF p_user_schema IS NULL OR p_user_schema !~ '^user_[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid user schema: %', p_user_schema;
  END IF;

  SELECT u.id
  INTO v_user_id
  FROM public.users u
  WHERE u.schema_name = p_user_schema
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF to_regclass(format('%I._table_registry', p_user_schema)) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_table IN EXECUTE format(
    'SELECT table_name
     FROM %I._table_registry
     WHERE table_name NOT LIKE ''\_%'' ESCAPE ''\''
     ORDER BY updated_at DESC
     LIMIT 25',
    p_user_schema
  )
  LOOP
    v_sql := format($q$
      WITH candidates AS (
        SELECT
          r.id,
          to_jsonb(r) - '_deleted_at' AS record_payload
        FROM %I.%I r
        WHERE r._deleted_at IS NULL
        ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC NULLS LAST
        LIMIT %s
      )
      INSERT INTO public.enrichment_jobs (
        user_id,
        source_type,
        source_ref,
        payload,
        status,
        attempt_count,
        next_run_at,
        created_at,
        updated_at
      )
      SELECT
        %L::uuid,
        'table',
        concat(%L, ':', c.id::text),
        jsonb_build_object('tableName', %L, 'record', c.record_payload),
        'pending',
        0,
        NOW(),
        NOW(),
        NOW()
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.enrichment_jobs j
        WHERE j.user_id = %L::uuid
          AND j.source_type = 'table'
          AND j.source_ref = concat(%L, ':', c.id::text)
          AND j.status IN ('pending', 'processing', 'retry', 'done')
      )
    $q$,
      p_user_schema,
      v_table.table_name,
      GREATEST(1, p_limit),
      v_user_id::text,
      v_table.table_name,
      v_table.table_name,
      v_user_id::text,
      v_table.table_name
    );

    EXECUTE v_sql;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total := v_total + COALESCE(v_inserted, 0);
  END LOOP;

  RETURN v_total;
END;
$$;

ALTER FUNCTION public.epitome_batch_extract_entities(TEXT, INTEGER)
  SET search_path = public;

