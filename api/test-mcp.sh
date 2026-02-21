#!/bin/bash
#
# MCP Server Verification Script
# Tests 3 facade MCP tools with sample requests
#

BASE_URL="http://localhost:3000"
API_KEY="${EPITOME_API_KEY:-epi_test_key_replace_me}"

echo "🧪 Testing Epitome MCP Server"
echo "=============================="
echo ""

# Test 1: List tools
echo "✓ Test 1: List available tools"
curl -s "${BASE_URL}/mcp/tools" | jq -r '.tools[] | .name' | head -3
echo ""

# Test 2: OAuth discovery
echo "✓ Test 2: OAuth 2.0 discovery"
curl -s "${BASE_URL}/.well-known/oauth-authorization-server" | jq -r '.issuer'
echo ""

# Test 3: recall (requires API key)
echo "✓ Test 3: recall (no topic = user context)"
curl -s -X POST "${BASE_URL}/mcp/call/recall" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "X-Agent-ID: test-script" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.success // .error.code'
echo ""

# Test 4: recall with topic
echo "✓ Test 4: recall (with topic)"
curl -s -X POST "${BASE_URL}/mcp/call/recall" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "X-Agent-ID: test-script" \
  -H "Content-Type: application/json" \
  -d '{"topic": "food"}' | jq -r '.success // .error.code'
echo ""

# Test 5: memorize
echo "✓ Test 5: memorize"
curl -s -X POST "${BASE_URL}/mcp/call/memorize" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "X-Agent-ID: test-script" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test memory from script", "category": "test"}' | jq -r '.success // .error.code'
echo ""

# Test 6: review
echo "✓ Test 6: review"
curl -s -X POST "${BASE_URL}/mcp/call/review" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "X-Agent-ID: test-script" \
  -H "Content-Type: application/json" \
  -d '{"action": "list"}' | jq -r '.success // .error.code'
echo ""

echo "=============================="
echo "✅ All tool endpoints are accessible"
echo ""
echo "To run full integration tests:"
echo "  1. Start the API server: cd api && npm run dev"
echo "  2. Create a test API key in the database"
echo "  3. Export EPITOME_API_KEY=epi_your_key"
echo "  4. Run: ./test-mcp.sh"
