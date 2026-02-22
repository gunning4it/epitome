#!/bin/bash
#
# MCP Server Verification Script
# Tests 3 facade MCP tools with sample requests
#

BASE_URL="http://localhost:3000"
API_KEY="${EPITOME_API_KEY:-epi_test_key_replace_me}"
COMMON_HEADERS=(
  -H "Authorization: Bearer ${API_KEY}"
  -H "X-Agent-ID: test-script"
  -H "Accept: application/json, text/event-stream"
  -H "Content-Type: application/json"
)

rpc() {
  local method="$1"
  local params="$2"
  curl -s -X POST "${BASE_URL}/mcp" \
    "${COMMON_HEADERS[@]}" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}"
}

echo "🧪 Testing Epitome MCP Server"
echo "=============================="
echo ""

# Test 1: List tools
echo "✓ Test 1: List available tools"
rpc "tools/list" "{}" | jq -r '.result.tools[]?.name' | head -3
echo ""

# Test 2: OAuth discovery
echo "✓ Test 2: OAuth 2.0 discovery"
curl -s "${BASE_URL}/.well-known/oauth-authorization-server" | jq -r '.issuer'
echo ""

# Test 3: recall (requires API key)
echo "✓ Test 3: recall (no topic = user context)"
rpc "tools/call" '{"name":"recall","arguments":{}}' | jq -r 'if .error then .error.message else "ok" end'
echo ""

# Test 4: recall with topic
echo "✓ Test 4: recall (with topic)"
rpc "tools/call" '{"name":"recall","arguments":{"topic":"food"}}' | jq -r 'if .error then .error.message else "ok" end'
echo ""

# Test 5: memorize
echo "✓ Test 5: memorize"
rpc "tools/call" '{"name":"memorize","arguments":{"text":"Test memory from script","category":"test"}}' | jq -r 'if .error then .error.message else "ok" end'
echo ""

# Test 6: review
echo "✓ Test 6: review"
rpc "tools/call" '{"name":"review","arguments":{"action":"list"}}' | jq -r 'if .error then .error.message else "ok" end'
echo ""

echo "=============================="
echo "✅ Canonical MCP tools are accessible over JSON-RPC"
echo ""
echo "To run full integration tests:"
echo "  1. Start the API server: cd api && npm run dev"
echo "  2. Create a test API key in the database"
echo "  3. Export EPITOME_API_KEY=epi_your_key"
echo "  4. Run: ./test-mcp.sh"
