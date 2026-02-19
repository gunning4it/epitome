// api/src/mcp-apps/annotations.ts

export const TOOL_ANNOTATIONS: Record<string, {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}> = {
  get_user_context: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  list_tables:      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  query_table:      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  search_memory:    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  query_graph:      { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  review_memories:  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  update_profile:   { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  add_record:       { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  save_memory:      { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
