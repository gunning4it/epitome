# Contributing to Epitome

Thank you for contributing to Epitome! This guide will help you maintain code quality and avoid common pitfalls.

## Table of Contents

- [Development Setup](#development-setup)
- [Dependency Management](#dependency-management)
- [Code Quality Standards](#code-quality-standards)
- [Testing Requirements](#testing-requirements)
- [Security Guidelines](#security-guidelines)
- [Git Workflow](#git-workflow)

---

## Development Setup

### Prerequisites

- **Node.js:** ≥22.0.0 (LTS recommended)
- **npm:** ≥10.0.0
- **PostgreSQL:** 17.7
- **Docker:** (optional, for local development)

### Verify Your Environment

```bash
# Check versions (must meet requirements)
node --version   # Should be v22.x.x or higher
npm --version    # Should be 10.x.x or higher
psql --version   # Should be 17.x or higher
```

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/gunning4it/epitome.git
cd epitome

# Install API dependencies
cd api
npm install

# Install Dashboard dependencies
cd ../dashboard
npm install

# Copy environment template
cp .env.example .env

# Start development environment
docker compose up -d
```

---

## Dependency Management

### 🚨 NEVER Use `--legacy-peer-deps`

**DO NOT RUN:**
```bash
npm install --legacy-peer-deps  # ❌ NEVER DO THIS
```

**Why it's dangerous:**
- Bypasses peer dependency resolution
- Creates hidden version conflicts
- Causes runtime errors from incompatible APIs
- Bloats bundle size with duplicate dependencies
- Creates technical debt that compounds over time

### ✅ Proper Way to Handle Peer Dependency Warnings

#### Step 1: Read the Warning Carefully

```bash
npm install
# Example warning:
# npm WARN ERESOLVE overriding peer dependency
# npm WARN found: react@19.2.4
# npm WARN peer react@"^18.0.0" from some-package@1.0.0
```

#### Step 2: Identify the Conflict

- **What package** has the peer dependency requirement?
- **What version** does it require?
- **What version** do you currently have?

#### Step 3: Fix the Root Cause

**Option A: Update the conflicting package**
```bash
npm install package-name@latest
```

**Option B: Update the package requesting the peer dependency**
```bash
npm update requesting-package
```

**Option C: Use package.json overrides (npm 8.3+)**
```json
{
  "overrides": {
    "problematic-package": "^desired-version"
  }
}
```

**Option D: Check if it's a false positive**
```bash
# Sometimes warnings are safe to ignore if the package works
# Test thoroughly before proceeding
npm test
```

#### Step 4: Document Your Decision

If you must use `--force` (rare), document why:

```bash
# ONLY use --force after trying all other options
npm install --force

# Then add a comment to package.json explaining why
```

### Version Consistency Between API and Dashboard

**IMPORTANT:** Some packages are used by both API and Dashboard. Keep versions consistent:

| Package | API Version | Dashboard Version | Notes |
|---------|-------------|-------------------|-------|
| `zod` | `^3.25.0` | `^3.25.0` | ✅ Must match for shared types |
| `typescript` | `^5.9.3` | `~5.9.3` | ✅ Close enough |
| `@types/node` | `^22.x` | `^24.x` | ⚠️ Different but intentional |

**Before adding a shared dependency:**
1. Check if it exists in the other workspace
2. Use the same major version
3. Document exceptions in this file

### Checking for Dependency Issues

```bash
# Check for duplicate packages
npm ls package-name

# Check for peer dependency issues
npm ls 2>&1 | grep -i "peer\|unmet"

# Audit for security vulnerabilities
npm audit

# Fix security issues (safe)
npm audit fix

# Fix security issues (breaking changes - review carefully)
npm audit fix --force
```

### Engines Field Enforcement

Both `api/package.json` and `dashboard/package.json` have an `engines` field:

```json
{
  "engines": {
    "node": ">=22.0.0",
    "npm": ">=10.0.0"
  }
}
```

**What this does:**
- Documents required Node.js and npm versions
- npm will warn if you use incompatible versions
- CI/CD pipelines can enforce these requirements

**To enforce strictly (optional):**
```bash
# Add to .npmrc (in your project or globally)
echo "engine-strict=true" >> .npmrc
```

---

## Code Quality Standards

### TypeScript

- **Strict mode:** Enabled in all workspaces
- **No implicit any:** Fix all type errors before committing
- **ESLint:** Run `npm run lint` before pushing

### File Structure

```
epitome/
├── api/               # Hono API server
│   ├── src/
│   │   ├── routes/    # API endpoints
│   │   ├── services/  # Business logic
│   │   ├── middleware/# Auth, CORS, rate limiting
│   │   ├── db/        # Database client + schema
│   │   └── mcp/       # MCP server
│   └── tests/         # Vitest tests
├── dashboard/         # React SPA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── lib/
│   └── tests/         # Component tests
└── .claude/           # Claude Code configuration
```

### Naming Conventions

- **Files:** `camelCase.ts` for code, `kebab-case.ts` for React components
- **Variables:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Types/Interfaces:** `PascalCase`
- **Database tables:** `snake_case`

---

## Testing Requirements

### Running Tests

```bash
# API tests
cd api
npm test                    # Run all tests
npm run test:coverage       # With coverage report

# Dashboard tests (when added)
cd dashboard
npm test
```

### Test Coverage Requirements

- **Minimum coverage:** 70% for production code
- **Critical paths:** 90%+ coverage (auth, payments, data access)
- **Tests required for:**
  - All new features
  - All bug fixes
  - Security-critical code

### Writing Good Tests

```typescript
// ✅ Good: Descriptive test names
describe('withUserSchema', () => {
  it('should guarantee single connection throughout transaction', async () => {
    // Test implementation
  });
});

// ❌ Bad: Vague test names
describe('db', () => {
  it('works', async () => {
    // Test implementation
  });
});
```

---

## Security Guidelines

### Never Commit Secrets

```bash
# Add to .gitignore (already configured)
.env
.env.local
*.key
*.pem
secrets/
```

### Security Checklist for PRs

- [ ] No hardcoded credentials
- [ ] Input validation with Zod schemas
- [ ] SQL queries use parameterized statements
- [ ] Authentication required for sensitive endpoints
- [ ] Rate limiting on public endpoints
- [ ] CORS configured correctly
- [ ] No console.log of sensitive data
- [ ] Error messages don't leak internal details

### Reporting Security Vulnerabilities

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, email: security@epitome.fyi (or see SECURITY.md for responsible disclosure policy)

---

## Git Workflow

### Branch Naming

```
feature/add-vector-search
fix/auth-token-expiry
security/fix-sql-injection
docs/update-api-reference
refactor/simplify-graph-service
```

### Commit Messages

Follow conventional commits:

```bash
# Format: <type>(<scope>): <subject>

feat(api): add rate limiting middleware
fix(auth): prevent session token timing attack
docs(readme): update deployment instructions
test(graph): add integration tests for entity deduplication
refactor(db): use transactions for schema isolation
security(cors): reject no-origin requests on auth endpoints

# Use co-authored-by for AI pair programming
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Pull Request Process

1. **Create feature branch** from `main`
2. **Make changes** with clear commits
3. **Run tests** and ensure they pass
4. **Run linter** and fix all errors
5. **Create PR** with description of changes
6. **Request review** from at least one teammate
7. **Address feedback** and update PR
8. **Merge** only after approval and CI passing

### Pre-Push Checklist

```bash
# Run before pushing
cd api
npm run lint        # TypeScript type check
npm test            # All tests pass
npm audit           # No high/critical vulnerabilities

cd ../dashboard
npm run lint
npm run build       # Build succeeds
```

---

## Common Issues and Solutions

### Issue: "Cannot find module '@/something'"

**Cause:** Path alias not resolved

**Solution:**
```bash
# Check tsconfig.json has paths configured
# For tests, ensure vitest.config.ts includes vite-tsconfig-paths plugin
```

### Issue: "EINTEGRITY" errors during npm install

**Cause:** Corrupted package-lock.json or npm cache

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Issue: PostgreSQL connection refused

**Cause:** Database not running or wrong credentials

**Solution:**
```bash
# Check Docker
docker compose ps

# Restart database
docker compose restart postgres

# Check .env file has correct DB credentials
```

---

## Questions?

- **General questions:** Open a GitHub Discussion
- **Bug reports:** Open a GitHub Issue (with reproduction steps)
- **Security issues:** Email security@epitome.fyi
- **Feature requests:** Open a GitHub Issue with [Feature Request] prefix

---

## License

By contributing to Epitome, you agree that your contributions will be licensed under the MIT License.
