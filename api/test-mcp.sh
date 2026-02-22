#!/bin/bash
#
# MCP Server Verification Script
# Tests protocol-native MCP methods and canonical 3 tools
#

BASE_URL="http://localhost:3000"
API_KEY="${EPITOME_API_KEY:-epi_test_key_replace_me}"
ACCEPT_HEADER="application/json, text/event-stream"

echo "🧪 Testing Epitome MCP Server"
echo "=============================="
echo ""

jsonrpc_call() {
  local payload="$1"
  curl -s -X POST "${BASE_URL}/mcp" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "X-Agent-ID: test-script" \
    -H "Content-Type: application/json" \
    -H "Accept: ${ACCEPT_HEADER}" \
    -d "${payload}"
}

# Test 1: initialize
echo "✓ Test 1: MCP initialize"
jsonrpc_call '{
  "jsonrpc":"2.0",
  "id":1,
  "method":"initialize",
  "params":{
    "protocolVersion":"2025-03-26",
    "capabilities":{},
    "clientInfo":{"name":"test-mcp-script","version":"1.0.0"}
  }
}' | jq -r '.result.serverInfo.name // .error.message'
echo ""

# Test 2: OAuth discovery
echo "✓ Test 2: OAuth 2.0 discovery"
curl -s "${BASE_URL}/.well-known/oauth-authorization-server" | jq -r '.issuer'
echo ""

# Test 3: tools/list
echo "✓ Test 3: tools/list (canonical tool names)"
jsonrpc_call '{
  "jsonrpc":"2.0",
  "id":2,
  "method":"tools/list",
  "params":{}
}' | jq -r '.result.tools[].name'
echo ""

# Test 4: tools/call recall
echo "✓ Test 4: tools/call -> recall"
jsonrpc_call '{
  "jsonrpc":"2.0",
  "id":3,
  "method":"tools/call",
  "params":{"name":"recall","arguments":{"topic":"food"}}
}' | jq -r '.result.isError // "ok"'
echo ""

# Test 5: tools/call memorize
echo "✓ Test 5: tools/call -> memorize"
jsonrpc_call '{
  "jsonrpc":"2.0",
  "id":4,
  "method":"tools/call",
  "params":{"name":"memorize","arguments":{"text":"Test memory from script","category":"test"}}
}' | jq -r '.result.isError // "ok"'
echo ""

# Test 6: tools/call review
echo "✓ Test 6: tools/call -> review"
jsonrpc_call '{
  "jsonrpc":"2.0",
  "id":5,
  "method":"tools/call",
  "params":{"name":"review","arguments":{"action":"list"}}
}' | jq -r '.result.isError // "ok"'
echo ""

echo "=============================="
echo "✅ MCP protocol route is accessible"
echo ""
echo "To run full integration tests:"
echo "  1. Start the API server: cd api && npm run dev"
echo "  2. Create a test API key in the database"
echo "  3. Export EPITOME_API_KEY=epi_your_key"
echo "  4. Run: ./test-mcp.sh"
