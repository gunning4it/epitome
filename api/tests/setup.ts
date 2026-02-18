/**
 * Vitest Global Setup
 *
 * Loads environment variables and sets up test configuration
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// CRITICAL: Set NODE_ENV to 'test' BEFORE loading dotenv
// This ensures auth middleware test mode activates and server doesn't start
process.env.NODE_ENV = 'test';

// Load .env.test if it exists, otherwise fall back to .env
const envFile = resolve(__dirname, '../.env.test');
config({ path: envFile });

// Set default test environment variables if not provided
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/epitome_test';
}

if (!process.env.SESSION_TTL_DAYS) {
  process.env.SESSION_TTL_DAYS = '7';
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
}

// Force single connection for tests to ensure SET search_path works correctly
process.env.DB_POOL_SIZE = '1';
