# Epitome API Test Suite

Comprehensive testing infrastructure for the Epitome API server covering unit, integration, MCP tools, and load testing.

## Test Organization

```
tests/
├── helpers/
│   ├── db.ts                 # Test database lifecycle management
│   └── app.ts                # Test app utilities
├── unit/
│   ├── mcp/
│   │   └── queryTable.test.ts
│   └── services/
│       ├── writeIngestion.test.ts
│       └── vectorRecentQuery.test.ts
├── integration/
│   ├── api/
│   │   ├── profile.test.ts   # Profile API endpoints (3 tests)
│   │   ├── tables.test.ts    # Tables API endpoints (5 tests)
│   │   ├── vectors.test.ts   # Vector API endpoints (2 tests)
│   │   ├── memory.test.ts    # Memory quality endpoints (3 tests)
│   │   ├── activity.test.ts  # Activity/audit endpoints (3 tests)
│   │   └── graph.test.ts     # Graph API endpoints (7 tests)
│   ├── services/
│   │   ├── graphService.test.ts
│   │   ├── entityExtraction.test.ts
│   │   ├── deduplication.test.ts
│   │   ├── threadLinking.test.ts
│   │   └── vectorService.test.ts
│   └── mcp/
│       └── tools.test.ts     # All 9 MCP tools
├── load/
│   └── concurrent-agents.test.ts  # Load and stress tests
└── setup.ts                  # Global test setup
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Load Tests Only
```bash
npm run test:load
```

### With Coverage
```bash
npm test -- --coverage
```

### Watch Mode (development)
```bash
npm test -- --watch
```

## Test Database Setup

Tests use a separate PostgreSQL database configured via `.env.test`:

```env
DATABASE_URL=postgresql://localhost:5432/epitome_test
SESSION_TTL_DAYS=7
JWT_SECRET=test-secret-key-for-testing-only
DB_POOL_SIZE=1
```

### Database Lifecycle

Each test suite follows this lifecycle:

1. **Setup** (`beforeEach`):
   - Create test user with `createTestUser()`
   - Generate isolated schema: `user_{uuid}`
   - Create all required tables (profile, tables, vectors, entities, edges, memory_quality, audit_log)
   - Grant test consent permissions

2. **Test Execution**:
   - Tests run in isolated schema
   - No cross-contamination between test users

3. **Cleanup** (`afterEach`):
   - Drop user schema with `cleanupTestUser()`
   - Delete consent rules
   - Remove user from public.users

### Test Isolation

Each test suite gets a completely isolated PostgreSQL schema:

```typescript
const testUser = await createTestUser();
// Creates: user_550e8400e29b41d4a716446655440000

// Test runs here...

await cleanupTestUser(testUser.userId);
// Drops schema and removes user
```

## Test Coverage Targets

| Component | Target | Current |
|-----------|--------|---------|
| Services | 90%+ | - |
| API Endpoints | 85%+ | - |
| SQL Sandbox | 100% | - |
| Auth Middleware | 95%+ | - |
| MCP Tools | 90%+ | - |
| Dashboard Components | 70%+ | - |

## Integration Test Patterns

### API Endpoint Testing

```typescript
import { createTestUser, cleanupTestUser } from '../helpers/db';
import { createBearerToken } from '../helpers/app';
import request from 'supertest';
import app from '@/index';

describe('Profile API', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    testUser = await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser(testUser.userId);
  });

  it('should return profile', async () => {
    const response = await request(app.fetch as any)
      .get('/v1/profile')
      .set('Authorization', createBearerToken(testUser.apiKey));

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('profile');
  });
});
```

### MCP Tool Testing

```typescript
import { getUserContext } from '@/mcp/tools/getUserContext';

describe('MCP Tools', () => {
  let mcpContext: { userId: string; agentId: string };

  beforeEach(async () => {
    testUser = await createTestUser();
    mcpContext = {
      userId: testUser.userId,
      agentId: 'test-agent',
    };

    // Grant consent
    await db.execute(sql`
      INSERT INTO public.consent_rules (user_id, agent_id, resource, action, granted)
      VALUES (${testUser.userId}, 'test-agent', '*', '*', true)
    `);
  });

  it('should return user context', async () => {
    const result = await getUserContext({}, mcpContext);

    expect(result).toHaveProperty('profile');
    expect(result).toHaveProperty('tables');
  });
});
```

## Test Factories

Located in `tests/helpers/db.ts`:

```typescript
// Profile data
const profile = factories.profile.basic();
// { name: 'Test User', timezone: 'America/New_York', ... }

// Memory data
const memory = factories.memory.userStated('I love pizza');
// { fact_statement: '...', confidence: 0.8, ... }

// Entity data
const entity = factories.entity.person('Alice');
// { entity_type: 'Person', canonical_name: 'Alice', ... }

// Vector data
const vector = factories.vector.embedding('memories', 'content', 1536);
// { collection: 'memories', content: '...', embedding: [...] }
```

## Load Test Configuration

Load tests simulate production-like conditions:

- **Concurrent Agents**: 50+ simultaneous MCP connections
- **SQL Sandbox**: 50+ injection attempts blocked
- **Vector Bursts**: 100+ embeddings added concurrently
- **Graph Traversal**: 25+ concurrent multi-hop queries
- **Connection Pool**: 200+ concurrent requests

### Running Load Tests

```bash
# Standard load tests (sets RUN_LOAD_TESTS=true)
npm run test:load

# Extended duration (10 minutes)
RUN_LOAD_TESTS=true npx vitest run tests/load --timeout=600000
```

## Security Testing

### SQL Sandbox Verification

All integration tests verify SQL sandbox blocks:

- DDL statements: `DROP`, `CREATE`, `ALTER`, `TRUNCATE`
- DML statements: `INSERT`, `UPDATE`, `DELETE`
- System catalog access: `pg_*`, `information_schema.*`
- Multi-statement: `; DROP TABLE users --`
- SQL injection: `' OR '1'='1`, `UNION SELECT`

### Schema Isolation Verification

```typescript
const user1 = await createTestUser();
const user2 = await createTestUser();

const isIsolated = await verifySchemaIsolation(user1, user2);
expect(isIsolated).toBe(true);
```

## Debugging Tests

### Enable Verbose Output

```bash
npm test -- --reporter=verbose
```

### Run Single Test File

```bash
npm test -- profile.test.ts
```

### Run Single Test

```bash
npm test -- -t "should return profile"
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "--", "--no-coverage"],
  "console": "integratedTerminal"
}
```

## CI/CD Integration

Tests run automatically on every PR via GitHub Actions:

```yaml
- Unit tests: ~30s
- Integration tests: ~2min
- Load tests: Only on release branches
```

See `.github/workflows/ci.yml` for configuration.

## Common Issues

### Database Connection Errors

**Problem**: `ECONNREFUSED` or `connection timeout`

**Solution**:
```bash
# Ensure PostgreSQL is running
brew services start postgresql@17

# Verify connection
psql postgresql://localhost:5432/epitome_test
```

### Schema Not Found

**Problem**: `schema "user_..." does not exist`

**Solution**: Tests automatically create/drop schemas. If you see this error, check that `createTestUser()` completed successfully.

### Test Timeouts

**Problem**: Tests timeout after 30s

**Solution**: Increase timeout for slow operations:
```typescript
it('should handle large dataset', async () => {
  // test code
}, 60000); // 60 second timeout
```

### Permission Denied

**Problem**: `permission denied for schema public`

**Solution**: Grant proper permissions:
```sql
GRANT ALL ON SCHEMA public TO epitome_user;
```

## Best Practices

1. **Isolation**: Each test should create its own test user
2. **Cleanup**: Always cleanup in `afterEach`
3. **Factories**: Use test factories for consistent test data
4. **Assertions**: Test both success and error cases
5. **Security**: Include auth/permission tests for every endpoint
6. **Performance**: Monitor test execution time (integration tests should be < 5s each)

## Contributing

When adding new features:

1. Write tests alongside implementation (not after)
2. Maintain coverage targets (see above)
3. Add new test factories to `helpers/db.ts`
4. Update this README if adding new test patterns
5. Run full suite before committing: `npm test -- --coverage`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [EPITOME_TECH_SPEC.md](../../EPITOME_TECH_SPEC.md) - §14 Testing Strategy
- [EPITOME_DATA_MODEL.md](../../EPITOME_DATA_MODEL.md) - Database schema reference
