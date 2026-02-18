#!/bin/bash

# =====================================================
# Epitome Database Verification Script
# =====================================================
# This script tests the PostgreSQL schema implementation
# Run after: docker compose up -d postgres
# =====================================================

set -e

DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-epitome_dev}"
DB_CONN="postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================================"
echo "Epitome Database Verification"
echo "======================================================"
echo "Database: ${DB_NAME}"
echo "Host: ${DB_HOST}:${DB_PORT}"
echo "User: ${DB_USER}"
echo ""

# Function to run SQL and check output
run_test() {
  local test_name="$1"
  local sql="$2"
  local expected="$3"

  echo -n "Testing: ${test_name}... "

  result=$(docker compose exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -t -A -c "${sql}" 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    if [ -n "$expected" ]; then
      if echo "$result" | grep -q "$expected"; then
        echo -e "${GREEN}✓ PASS${NC}"
        return 0
      else
        echo -e "${RED}✗ FAIL${NC}"
        echo "  Expected: $expected"
        echo "  Got: $result"
        return 1
      fi
    else
      echo -e "${GREEN}✓ PASS${NC}"
      return 0
    fi
  else
    echo -e "${RED}✗ FAIL${NC}"
    echo "  Error: $result"
    return 1
  fi
}

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

# =====================================================
# Test 1: PostgreSQL Version
# =====================================================
((TESTS_RUN++))
if run_test "PostgreSQL version" "SELECT version();" "PostgreSQL 17"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 2: Required Extensions
# =====================================================
((TESTS_RUN++))
if run_test "pgvector extension" "SELECT extversion FROM pg_extension WHERE extname = 'vector';" "0.8"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "pg_trgm extension" "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
echo -n "Testing: pg_cron extension (optional)... "
pg_cron_available=$(docker compose exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -t -A -c "SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'pg_cron';" 2>/dev/null || echo "0")
if [ "$pg_cron_available" = "0" ]; then
  echo -e "${YELLOW}~ SKIP${NC} (not available in this PostgreSQL build)"
  ((TESTS_PASSED++))
elif run_test "pg_cron extension" "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_cron';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "uuid-ossp extension" "SELECT COUNT(*) FROM pg_extension WHERE extname = 'uuid-ossp';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 3: Public Schema Tables
# =====================================================
((TESTS_RUN++))
if run_test "users table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "api_keys table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'api_keys';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "sessions table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "oauth_connections table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oauth_connections';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "agent_registry table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_registry';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "system_config table exists" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_config';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 4: System Config Seeding
# =====================================================
((TESTS_RUN++))
if run_test "system_config seeded" "SELECT COUNT(*) FROM public.system_config;" "5"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 5: create_user_schema Function
# =====================================================
((TESTS_RUN++))
if run_test "create_user_schema function exists" "SELECT COUNT(*) FROM pg_proc WHERE proname = 'create_user_schema';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 6: Create Test User Schema
# =====================================================
echo ""
echo "======================================================"
echo "Creating Test User Schema"
echo "======================================================"

TEST_SCHEMA="user_test_$(date +%s)"
echo "Schema name: ${TEST_SCHEMA}"

((TESTS_RUN++))
if run_test "Create user schema" "SELECT public.create_user_schema('${TEST_SCHEMA}', 1536);"; ""; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 7: User Schema Tables
# =====================================================
((TESTS_RUN++))
if run_test "User schema exists" "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${TEST_SCHEMA}';" "1"; then
  ((TESTS_PASSED++))
fi

USER_SCHEMA_TABLES=(
  "profile"
  "memory_meta"
  "vectors"
  "entities"
  "edges"
  "audit_log"
  "consent_rules"
  "_table_registry"
  "_vector_collections"
  "_schema_version"
)

for table in "${USER_SCHEMA_TABLES[@]}"; do
  ((TESTS_RUN++))
  if run_test "User schema has ${table}" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${TEST_SCHEMA}' AND table_name = '${table}';" "1"; then
    ((TESTS_PASSED++))
  fi
done

# =====================================================
# Test 8: Profile Seeding
# =====================================================
((TESTS_RUN++))
if run_test "Profile seeded" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM profile;" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "Profile version = 1" "SET search_path TO ${TEST_SCHEMA}; SELECT version FROM profile LIMIT 1;" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 9: User Schema Functions
# =====================================================
((TESTS_RUN++))
if run_test "update_updated_at function" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_proc WHERE proname = 'update_updated_at';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "increment_record_count function" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_proc WHERE proname = 'increment_record_count';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "detect_contradictions function" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_proc WHERE proname = 'detect_contradictions';" "1"; then
  ((TESTS_PASSED++))
fi

((TESTS_RUN++))
if run_test "reinforce_edge function" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_proc WHERE proname = 'reinforce_edge';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 10: Indexes
# =====================================================
echo ""
echo "======================================================"
echo "Verifying Indexes"
echo "======================================================"

# Count indexes in user schema
INDEX_COUNT=$(docker compose exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -t -A -c "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_indexes WHERE schemaname = '${TEST_SCHEMA}';")

echo "Total indexes in user schema: ${INDEX_COUNT}"

if [ "$INDEX_COUNT" -ge 30 ]; then
  echo -e "${GREEN}✓ Index count looks good (>= 30)${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠ Warning: Expected 35+ indexes, found ${INDEX_COUNT}${NC}"
fi
((TESTS_RUN++))

# Check for HNSW index on vectors
((TESTS_RUN++))
if run_test "HNSW index on vectors.embedding" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE '%embedding%' AND tablename = 'vectors';" "1"; then
  ((TESTS_PASSED++))
fi

# Check for GIN trigram index on entities
((TESTS_RUN++))
if run_test "GIN trigram index on entities.name" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE '%name_trgm%' AND tablename = 'entities';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Test 11: Data Operations
# =====================================================
echo ""
echo "======================================================"
echo "Testing Data Operations"
echo "======================================================"

# Insert a memory_meta record
((TESTS_RUN++))
if run_test "Insert memory_meta" "SET search_path TO ${TEST_SCHEMA}; INSERT INTO memory_meta (source_type, source_ref, origin, confidence) VALUES ('vector', 'test:1', 'user_stated', 0.95) RETURNING id;" ""; then
  ((TESTS_PASSED++))
fi

# Insert an entity
((TESTS_RUN++))
if run_test "Insert entity" "SET search_path TO ${TEST_SCHEMA}; INSERT INTO entities (type, name, properties, confidence) VALUES ('person', 'Test Person', '{\"relation\": \"friend\"}', 0.90) RETURNING id;" ""; then
  ((TESTS_PASSED++))
fi

# Insert another entity
docker compose exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -c "SET search_path TO ${TEST_SCHEMA}; INSERT INTO entities (type, name, properties, confidence) VALUES ('place', 'Test Place', '{\"address\": \"123 Main St\"}', 0.85);" > /dev/null 2>&1

# Insert an edge
((TESTS_RUN++))
if run_test "Insert edge" "SET search_path TO ${TEST_SCHEMA}; INSERT INTO edges (source_id, target_id, relation, weight, confidence) VALUES (1, 2, 'visited', 2.0, 0.90) RETURNING id;" ""; then
  ((TESTS_PASSED++))
fi

# Query edge
((TESTS_RUN++))
if run_test "Query edge" "SET search_path TO ${TEST_SCHEMA}; SELECT COUNT(*) FROM edges WHERE relation = 'visited';" "1"; then
  ((TESTS_PASSED++))
fi

# =====================================================
# Summary
# =====================================================
echo ""
echo "======================================================"
echo "Verification Summary"
echo "======================================================"
echo "Tests run: ${TESTS_RUN}"
echo "Tests passed: ${TESTS_PASSED}"
echo "Tests failed: $((TESTS_RUN - TESTS_PASSED))"

if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
  echo -e "${GREEN}All tests passed! ✓${NC}"
  echo ""
  echo "Database schema is ready for development."
  echo ""
  echo "Next steps:"
  echo "  1. Start the API server: cd api && npm install && npm run dev"
  echo "  2. Run Drizzle migrations: npm run db:push"
  echo "  3. Start the dashboard: cd dashboard && npm install && npm run dev"
  exit 0
else
  echo -e "${RED}Some tests failed. Please review the output above.${NC}"
  exit 1
fi
