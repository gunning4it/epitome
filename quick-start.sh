#!/bin/bash

# =====================================================
# EPITOME QUICK START SCRIPT
# =====================================================
# Automated setup for Docker Compose deployment
# Usage: ./quick-start.sh
# =====================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                      ║${NC}"
echo -e "${BLUE}║     EPITOME QUICK START SETUP        ║${NC}"
echo -e "${BLUE}║                                      ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}⚠ Docker not found. Please install Docker Desktop:${NC}"
  echo "  https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}⚠ Docker Compose not found. Please upgrade Docker Desktop.${NC}"
  exit 1
fi

echo -e "${GREEN}✓${NC} Docker and Docker Compose are installed"
echo ""

# Check if .env exists
if [ -f ".env" ]; then
  echo -e "${YELLOW}⚠ .env file already exists${NC}"
  read -p "Do you want to reconfigure? (y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Using existing .env file..."
  else
    mv .env .env.backup.$(date +%s)
    echo "Backed up existing .env"
  fi
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
  echo "Creating .env file from template..."
  cp .env.example .env
  echo -e "${GREEN}✓${NC} Created .env file"
  echo ""

  # Interactive configuration
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "CONFIGURATION"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Generate secrets
  echo "Generating secure secrets..."
  SESSION_SECRET=$(openssl rand -base64 32)
  ENCRYPTION_KEY=$(openssl rand -base64 32)
  POSTGRES_PASSWORD=$(openssl rand -base64 16)

  # Update .env
  sed -i.bak "s|SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|g" .env
  sed -i.bak "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|g" .env
  sed -i.bak "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|g" .env
  rm .env.bak

  echo -e "${GREEN}✓${NC} Generated SESSION_SECRET"
  echo -e "${GREEN}✓${NC} Generated ENCRYPTION_KEY"
  echo -e "${GREEN}✓${NC} Generated POSTGRES_PASSWORD"
  echo ""

  # Prompt for API keys
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "REQUIRED: API Keys"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  read -p "OpenAI API Key (from https://platform.openai.com/api-keys): " OPENAI_KEY
  if [ -n "$OPENAI_KEY" ]; then
    sed -i.bak "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=$OPENAI_KEY|g" .env
    rm .env.bak
    echo -e "${GREEN}✓${NC} Set OPENAI_API_KEY"
  else
    echo -e "${YELLOW}⚠ Warning: OpenAI API key not set. Update .env manually.${NC}"
  fi
  echo ""

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "REQUIRED: OAuth Credentials"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Get Google OAuth credentials from:"
  echo "  https://console.cloud.google.com/apis/credentials"
  echo ""
  echo "Authorized redirect URI:"
  echo "  http://localhost:3000/auth/callback"
  echo ""

  read -p "Google Client ID: " GOOGLE_ID
  read -p "Google Client Secret: " GOOGLE_SECRET

  if [ -n "$GOOGLE_ID" ] && [ -n "$GOOGLE_SECRET" ]; then
    sed -i.bak "s|GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=$GOOGLE_ID|g" .env
    sed -i.bak "s|GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=$GOOGLE_SECRET|g" .env
    rm .env.bak
    echo -e "${GREEN}✓${NC} Set Google OAuth credentials"
  else
    echo -e "${YELLOW}⚠ Warning: Google OAuth not configured. Update .env manually.${NC}"
  fi
  echo ""

  # Optional GitHub OAuth
  read -p "Configure GitHub OAuth? (y/N): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Get GitHub OAuth credentials from:"
    echo "  https://github.com/settings/developers"
    echo ""
    read -p "GitHub Client ID: " GITHUB_ID
    read -p "GitHub Client Secret: " GITHUB_SECRET
    if [ -n "$GITHUB_ID" ] && [ -n "$GITHUB_SECRET" ]; then
      sed -i.bak "s|GITHUB_CLIENT_ID=.*|GITHUB_CLIENT_ID=$GITHUB_ID|g" .env
      sed -i.bak "s|GITHUB_CLIENT_SECRET=.*|GITHUB_CLIENT_SECRET=$GITHUB_SECRET|g" .env
      rm .env.bak
      echo -e "${GREEN}✓${NC} Set GitHub OAuth credentials"
    fi
  fi
  echo ""
fi

# Pull latest images
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PULLING DOCKER IMAGES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
docker compose pull

# Build images
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "BUILDING SERVICES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
docker compose build

# Start services
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STARTING SERVICES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
docker compose up -d

# Wait for services
echo ""
echo "Waiting for services to start (30 seconds)..."
sleep 30

# Verify deployment
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VERIFYING DEPLOYMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "./verify-deployment.sh" ]; then
  chmod +x ./verify-deployment.sh
  ./verify-deployment.sh
else
  # Basic verification
  if docker compose ps | grep -q "epitome_postgres.*running"; then
    echo -e "${GREEN}✓${NC} PostgreSQL is running"
  fi
  if docker compose ps | grep -q "epitome_api.*running"; then
    echo -e "${GREEN}✓${NC} API is running"
  fi
  if docker compose ps | grep -q "epitome_dashboard.*running"; then
    echo -e "${GREEN}✓${NC} Dashboard is running"
  fi
fi

# Success message
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                      ║${NC}"
echo -e "${GREEN}║     EPITOME IS READY! 🚀             ║${NC}"
echo -e "${GREEN}║                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo "Access Points:"
echo -e "  ${BLUE}•${NC} Dashboard:  ${GREEN}http://localhost:5173${NC}"
echo -e "  ${BLUE}•${NC} API:        ${GREEN}http://localhost:3000${NC}"
echo -e "  ${BLUE}•${NC} Database:   ${GREEN}localhost:5432${NC}"
echo ""
echo "Next Steps:"
echo "  1. Open: http://localhost:5173/onboarding"
echo "  2. Sign in with Google or GitHub"
echo "  3. Complete your profile"
echo "  4. Start building your knowledge graph!"
echo ""
echo "Useful Commands:"
echo "  • View logs:      ${BLUE}docker compose logs -f [service]${NC}"
echo "  • Restart:        ${BLUE}docker compose restart${NC}"
echo "  • Stop all:       ${BLUE}docker compose down${NC}"
echo "  • Database shell: ${BLUE}docker compose exec postgres psql -U postgres -d epitome${NC}"
echo ""
