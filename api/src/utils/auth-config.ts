/**
 * Better Auth Configuration
 *
 * OAuth 2.0 provider setup for Google and GitHub
 */

import { betterAuth } from 'better-auth';
import { db } from '@/db/client';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

/**
 * Better Auth instance with OAuth providers
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: false, // We only use OAuth
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectURI:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3000/v1/auth/callback',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      redirectURI:
        process.env.GITHUB_CALLBACK_URL ||
        'http://localhost:3000/v1/auth/callback',
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * parseInt(process.env.SESSION_TTL_DAYS || '7'), // Default 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // Cache for 5 minutes
    },
  },
  advanced: {
    cookiePrefix: 'epitome',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

/**
 * OAuth provider URLs
 */
export const OAUTH_PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'profile', 'email'],
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
} as const;
