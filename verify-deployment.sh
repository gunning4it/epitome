#!/bin/bash

# =====================================================
# EPITOME DEPLOYMENT VERIFICATION SCRIPT
# =====================================================
# Verifies Docker Compose deployment is healthy
# Usage: ./verify-deployment.sh
# =====================================================

set -e

echo "=========================================="
echo "Epitome Deployment Verification"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
check_pass() {
  echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
  exit 1
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# =====================================================
# 1. Check Docker Compose is installed
# =====================================================
echo "1. Checking prerequisites..."
if ! command -v docker &> /dev/null; then
  check_fail "Docker is not installed. Install from: https://docs.docker.com/get-docker/"
fi
check_pass "Docker is installed: $(docker --version)"

if ! docker compose version &> /dev/null; then
  check_fail "Docker Compose is not installed or outdated. Upgrade Docker Desktop."
fi
check_pass "Docker Compose is installed: $(docker compose version)"
echo ""

# =====================================================
# 2. Check .env file exists
# =====================================================
echo "2. Checking configuration..."
if [ ! -f ".env" ]; then
  check_warn ".env file not found. Copying from .env.example..."
  cp .env.example .env
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "IMPORTANT: Edit .env file with your credentials:"
  echo "  - OPENAI_API_KEY"
  echo "  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"
  echo "  - SESSION_SECRET (generate with: openssl rand -base64 32)"
  echo "  - ENCRYPTION_KEY (generate with: openssl rand -base64 32)"
  echo "  - POSTGRES_PASSWORD (change from default)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  check_fail "Please configure .env file before continuing"
fi
check_pass ".env file exists"

# Check required variables
required_vars=("OPENAI_API_KEY" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_SECRET" "SESSION_SECRET" "ENCRYPTION_KEY")
missing_vars=()

for var in "${required_vars[@]}"; do
  if grep -q "^${var}=.*your_.*\|^${var}=CHANGE_ME\|^${var}=$" .env; then
    missing_vars+=("$var")
  fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
  check_fail "Missing or placeholder values in .env: ${missing_vars[*]}"
fi
check_pass "Required environment variables are configured"
echo ""

# =====================================================
# 3. Check Docker services are running
# =====================================================
echo "3. Checking Docker services..."
if ! docker compose ps | grep -q "epitome_postgres.*running"; then
  check_warn "PostgreSQL service not running. Starting services..."
  docker compose up -d
  echo "Waiting for services to start (30 seconds)..."
  sleep 30
fi

# Check each service
services=("postgres" "api" "dashboard")
for service in "${services[@]}"; do
  if docker compose ps | grep -q "epitome_${service}.*running"; then
    check_pass "${service} service is running"
  else
    check_fail "${service} service is not running"
  fi
done
echo ""

# =====================================================
# 4. Check service health
# =====================================================
echo "4. Checking service health..."

# PostgreSQL health
if docker compose exec -T postgres pg_isready -U postgres -d epitome &> /dev/null; then
  check_pass "PostgreSQL is accepting connections"
else
  check_fail "PostgreSQL is not accepting connections"
fi

# Check extensions
echo "   Checking PostgreSQL extensions..."
extensions=("uuid-ossp" "vector" "pg_trgm" "pg_cron")
for ext in "${extensions[@]}"; do
  if docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT 1 FROM pg_extension WHERE extname='$ext';" | grep -q "1"; then
    check_pass "   Extension '$ext' is installed"
  else
    check_warn "   Extension '$ext' is not installed (may be normal on first run)"
  fi
done

# API health check
echo ""
echo "   Checking API server..."
sleep 2  # Give API time to start
api_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
if [ "$api_response" = "200" ]; then
  check_pass "API server is healthy (http://localhost:3000)"
else
  check_warn "API server returned status: $api_response (may still be starting)"
fi

# Dashboard health check
echo ""
echo "   Checking dashboard..."
dashboard_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/health || echo "000")
if [ "$dashboard_response" = "200" ]; then
  check_pass "Dashboard is healthy (http://localhost:5173)"
else
  check_warn "Dashboard returned status: $dashboard_response (may still be starting)"
fi
echo ""

# =====================================================
# 5. Check database schema
# =====================================================
echo "5. Checking database schema..."

# Check public schema tables
public_tables=("users" "api_keys" "sessions" "oauth_connections" "agent_registry" "system_config")
for table in "${public_tables[@]}"; do
  if docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$table';" | grep -q "1"; then
    check_pass "Table 'public.$table' exists"
  else
    check_fail "Table 'public.$table' is missing"
  fi
done

# Check create_user_schema function exists
if docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT 1 FROM pg_proc WHERE proname='create_user_schema';" | grep -q "1"; then
  check_pass "Function 'create_user_schema()' exists"
else
  check_fail "Function 'create_user_schema()' is missing"
fi
echo ""

# =====================================================
# 6. Test database operations
# =====================================================
echo "6. Testing database operations..."

# Create test user schema
test_schema="user_test$(date +%s)"
if docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT public.create_user_schema('$test_schema', 1536);" &> /dev/null; then
  check_pass "Created test user schema: $test_schema"

  # Verify schema exists
  if docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT 1 FROM information_schema.schemata WHERE schema_name='$test_schema';" | grep -q "1"; then
    check_pass "Test schema exists in database"
  else
    check_fail "Test schema was not created"
  fi

  # Verify tables exist in schema
  expected_tables=("profile" "vectors" "entities" "edges" "memory_meta" "audit_log" "consent_rules")
  table_count=$(docker compose exec -T postgres psql -U postgres -d epitome -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='$test_schema';" | xargs)
  if [ "$table_count" -ge "${#expected_tables[@]}" ]; then
    check_pass "User schema has $table_count tables (expected ${#expected_tables[@]}+)"
  else
    check_fail "User schema has only $table_count tables (expected ${#expected_tables[@]}+)"
  fi

  # Cleanup test schema
  docker compose exec -T postgres psql -U postgres -d epitome -c "DROP SCHEMA $test_schema CASCADE;" &> /dev/null
  check_pass "Cleaned up test schema"
else
  check_fail "Failed to create test user schema"
fi
echo ""

# =====================================================
# 7. Check container logs for errors
# =====================================================
echo "7. Checking for errors in logs..."

# Check postgres logs
if docker compose logs postgres --tail=50 | grep -i "ERROR\|FATAL" | grep -v "pg_cron" > /dev/null; then
  check_warn "Found errors in PostgreSQL logs (check with: docker compose logs postgres)"
else
  check_pass "No critical errors in PostgreSQL logs"
fi

# Check API logs
if docker compose logs api --tail=50 | grep -i "ERROR\|FATAL" > /dev/null; then
  check_warn "Found errors in API logs (check with: docker compose logs api)"
else
  check_pass "No critical errors in API logs"
fi

# Check dashboard logs
if docker compose logs dashboard --tail=20 | grep -i "ERROR\|FATAL" > /dev/null; then
  check_warn "Found errors in dashboard logs (check with: docker compose logs dashboard)"
else
  check_pass "No critical errors in dashboard logs"
fi
echo ""

# =====================================================
# 8. Check disk space
# =====================================================
echo "8. Checking resources..."

# Check volume sizes
postgres_volume=$(docker volume inspect epitome_postgres_data --format '{{.Mountpoint}}' 2>/dev/null)
if [ -n "$postgres_volume" ]; then
  check_pass "PostgreSQL data volume exists"
else
  check_warn "PostgreSQL volume not found (may be using different name)"
fi

# Check Docker disk usage
docker_df=$(docker system df --format "table {{.Type}}\t{{.TotalCount}}\t{{.Size}}" | grep -i images | awk '{print $3}')
check_pass "Docker images size: ${docker_df:-unknown}"
echo ""

# =====================================================
# SUMMARY
# =====================================================
echo "=========================================="
echo "Verification Complete!"
echo "=========================================="
echo ""
echo "Access Points:"
echo "  • Dashboard:  http://localhost:5173"
echo "  • API:        http://localhost:3000"
echo "  • Database:   localhost:5432 (user: postgres, db: epitome)"
echo ""
echo "Next Steps:"
echo "  1. Navigate to http://localhost:5173/onboarding"
echo "  2. Sign in with Google or GitHub OAuth"
echo "  3. Complete profile setup"
echo "  4. Your user schema will be automatically created"
echo ""
echo "Useful Commands:"
echo "  • View logs:      docker compose logs -f [service]"
echo "  • Restart:        docker compose restart"
echo "  • Stop all:       docker compose down"
echo "  • Reset data:     docker compose down -v"
echo "  • Database shell: docker compose exec postgres psql -U postgres -d epitome"
echo ""
echo "=========================================="
