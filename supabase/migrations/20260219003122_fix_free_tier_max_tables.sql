-- Fix config drift: align free_tier_limits max_tables with code (5 → 2)
UPDATE public.system_config
SET value = '{"max_tables": 2, "max_agents": 3, "max_graph_entities": 100, "audit_retention_days": 30}'
WHERE key = 'free_tier_limits';
