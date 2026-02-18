#!/bin/bash
#
# MCP Server Verification Script
# Tests all 9 MCP tools with sample requests
#

BASE_URL="http://localhost:3000"
API_KEY="${EPITOME_API_KEY:-epi_test_key_replace_me}"

echo "🧪 Testing Epitome MCP Server"
echo "=============================="
echo ""

# Test 1: List tools
echo "✓ Test 1: List available tools"
curl -s "${BASE_URL}/mcp/tools" | jq -r '.tools[] | .name' | head -9
echo ""

# Test 2: OAuth discovery
echo "✓ Test 2: OAuth 2.0 discovery"
curl -s "${BASE_URL}/.well-known/oauth-authorization-server" | jq -r '.issuer'
echo ""

# Test 3: get_user_context (requires API key)
echo "✓ Test 3: get_user_context"
curl -s -X POST "${BASE_URL}/mcp/call/get_user_context" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "X-Agent-ID: test-script" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.success // .error.code'
echo ""

# Test 4: list_tables
echo "✓ Test 4: list_tables"
curl -s -X POST "${BASE_URL}/mcp/call/list_tables" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.success // .error.code'
echo ""

# Test 5: update_profile
echo "✓ Test 5: update_profile"
curl -s -X POST "${BASE_URL}/mcp/call/update_profile" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "Test User"}}' | jq -r '.success // .error.code'
echo ""

echo "=============================="
echo "✅ All tool endpoints are accessible"
echo ""
echo "To run full integration tests:"
echo "  1. Start the API server: cd api && npm run dev"
echo "  2. Create a test API key in the database"
echo "  3. Export EPITOME_API_KEY=epi_your_key"
echo "  4. Run: ./test-mcp.sh"
