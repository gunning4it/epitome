# Quick Start — Epitome Tests

## TL;DR

```bash
# Run all tests
npm test

# Run unit-only suite (no DB required)
npm run test:unit

# Run integration-only suite (DB required)
npm run test:integration

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- profile.test.ts

# Watch mode
npm test -- --watch
```

## Prerequisites

1. **PostgreSQL 17 running**
   ```bash
   brew services start postgresql@17
   ```

2. **Test database exists**
   ```bash
   createdb epitome_test
   psql epitome_test < ../init.sql
   ```

3. **Environment configured**
   ```bash
   # api/.env.test
   DATABASE_URL=postgresql://localhost:5432/epitome_test
   ```

## Test Categories

| Command | What It Does | Duration |
|---------|--------------|----------|
| `npm test` | All tests | ~30s |
| `npm run test:integration` | API + MCP + DB-coupled services | ~20s |
| `npm run test:load` | Stress tests (forces RUN_LOAD_TESTS=true) | ~2min |
| `npm run test:unit` | Pure unit tests | ~5s |

## Common Tasks

### Run tests before committing
```bash
npm test -- --coverage
```

### Debug failing test
```bash
npm test -- -t "should return profile"
```

### Check coverage
```bash
npm test -- --coverage
open coverage/index.html
```

### Run tests in parallel
```bash
npm test -- --reporter=verbose --pool=threads --poolOptions.threads.maxThreads=4
```

## Troubleshooting

**Database connection failed**
```bash
# Check PostgreSQL is running
brew services list

# Restart if needed
brew services restart postgresql@17
```

**Schema already exists**
```bash
# Tests auto-cleanup, but if interrupted:
psql epitome_test -c "DROP SCHEMA IF EXISTS user_* CASCADE;"
```

**Permission denied**
```bash
# Grant permissions
psql epitome_test -c "GRANT ALL ON SCHEMA public TO $(whoami);"
```

## Coverage Targets

- Services: 90%+
- API: 85%+
- SQL Sandbox: 100%
- Auth: 95%+

CI will fail if targets not met.

## CI/CD

Tests run automatically on:
- Every pull request (integration tests)
- Main branch push (integration + security)
- Release (integration + load tests)

View results: GitHub Actions tab

## Need Help?

- Full guide: `tests/README.md`
- Test patterns: `tests/helpers/db.ts`
- CI config: `.github/workflows/ci.yml`
- Tech spec: `EPITOME_TECH_SPEC.md` §14
