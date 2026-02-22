# @epitomefyi/sdk

Official TypeScript SDK for the Epitome REST API.

## Install

```bash
npm install @epitomefyi/sdk
```

For Vercel AI SDK tool-calling:

```bash
npm install ai @ai-sdk/openai
```

## Initialize

```ts
import { EpitomeClient } from '@epitomefyi/sdk';

const client = new EpitomeClient({
  apiKey: process.env.EPITOME_API_KEY!,
  // Optional for self-hosted Epitome:
  // baseUrl: 'http://localhost:3000',
  defaultCollection: 'memories',
});
```

## Direct Client Usage

```ts
// Save + search memory
await client.saveMemory({
  text: 'I prefer concise execution updates.',
  collection: 'preferences',
});

const memories = await client.searchMemory({
  query: 'communication preference',
  limit: 5,
  minSimilarity: 0.7,
});

// Context snapshot
const context = await client.getUserContext({ topic: 'project priorities' });
```

## Profile, Table, and Graph Operations

```ts
const profile = await client.getProfile();

await client.updateProfile({
  patch: {
    timezone: 'America/New_York',
    preferences: { communication: 'concise' },
  },
});

await client.addRecord({
  table: 'projects',
  data: { name: 'PRD 2 SDK', status: 'in_progress' },
});

const rows = await client.queryTable({
  table: 'projects',
  filters: { status: 'in_progress' },
  limit: 20,
});

const graph = await client.queryGraph({
  query: 'project priorities',
  limit: 10,
});
```

## AI SDK Tools Adapter

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { epitomeTools } from '@epitomefyi/sdk/ai-sdk';

const tools = epitomeTools({
  apiKey: process.env.EPITOME_API_KEY!,
  collectionDefaults: {
    searchMemory: 'memories',
    saveMemory: 'memories',
  },
});

const result = await generateText({
  model: openai('gpt-4o-mini'),
  tools,
  prompt: 'What do you know about my project priorities?',
});
```

Available tools:
- `searchMemory`
- `saveMemory`
- `getUserContext`

## Auth and Error Handling

The SDK maps API failures into typed errors:
- `EpitomeAuthError` (401)
- `EpitomeConsentError` (403)
- `EpitomeRateLimitError` (429, includes `rateLimit`)
- `EpitomeValidationError` (400/422)
- `EpitomeServerError` (5xx)

```ts
import { EpitomeAuthError, EpitomeRateLimitError } from '@epitomefyi/sdk';

try {
  await client.getProfile();
} catch (error) {
  if (error instanceof EpitomeAuthError) {
    console.error('Invalid API key');
  } else if (error instanceof EpitomeRateLimitError) {
    console.error('Retry after', error.rateLimit?.retryAfter);
  }
}
```

## Hosted vs Self-Hosted

- Hosted default base URL: `https://epitome.fyi` (SDK appends `/v1`)
- Self-hosted: pass your API origin in `baseUrl`, e.g. `http://localhost:3000`

## Browser CORS Note

Use the SDK server-side whenever possible. Avoid exposing API keys directly in browser code.
If browser usage is required, configure CORS and key scoping appropriately.
