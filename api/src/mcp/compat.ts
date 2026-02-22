/**
 * MCP compatibility flags.
 *
 * Defaults are intentionally strict:
 * - Legacy tool name translation: OFF
 * - Legacy REST MCP endpoints: OFF
 */

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

/**
 * Enables legacy tool-name translation for JSON-RPC tools/call payloads.
 * Off by default to enforce strict 3-tool MCP contract.
 */
export function isLegacyToolTranslationEnabled(): boolean {
  return isFlagEnabled(process.env.MCP_ENABLE_LEGACY_TOOL_TRANSLATION);
}

/**
 * Enables legacy REST MCP endpoints:
 * - GET /mcp/tools
 * - POST /mcp/call/:toolName
 *
 * Off by default to keep MCP surface protocol-native.
 */
export function isLegacyRestEndpointsEnabled(): boolean {
  return isFlagEnabled(process.env.MCP_ENABLE_LEGACY_REST_ENDPOINTS);
}
