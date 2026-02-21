// api/src/mcp-apps/annotations.ts

export const TOOL_ANNOTATIONS: Record<string, {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}> = {
  recall:    { readOnlyHint: true,  destructiveHint: false, openWorldHint: true },
  memorize:  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  review:    { readOnlyHint: false, destructiveHint: true,  openWorldHint: true },
};
