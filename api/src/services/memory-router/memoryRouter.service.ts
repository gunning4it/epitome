import { getLatestProfile } from '@/services/profile.service';
import { ingestProfileUpdate } from '@/services/writeIngestion.service';
import { getUserContext } from '@/services/tools/getUserContext';
import { searchMemory } from '@/services/tools/searchMemory';
import { saveMemory } from '@/services/tools/saveMemory';
import type { ToolContext } from '@/services/tools/types';
import { logger } from '@/utils/logger';
import type {
  MemoryRouterControlHeaders,
  MemoryRouterSettings,
  ProviderAdapter,
} from '@/services/memory-router/types';

const DEFAULT_COLLECTION = 'memories';

interface PrepareRoutedPayloadInput {
  adapter: ProviderAdapter;
  requestBody: Record<string, unknown>;
  toolContext: ToolContext;
  controlHeaders: MemoryRouterControlHeaders;
}

interface PrepareRoutedPayloadOutput {
  requestBody: Record<string, unknown>;
  userQuery: string | null;
  usedMemoryContext: boolean;
}

interface PersistConversationInput {
  provider: 'openai' | 'anthropic';
  adapter: ProviderAdapter;
  requestBody: Record<string, unknown>;
  responseBody?: unknown;
  assistantText?: string;
  userQuery: string | null;
  toolContext: ToolContext;
  controlHeaders: MemoryRouterControlHeaders;
}

interface ParsedRouterProfile {
  enabled: boolean;
  defaultCollection: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRouterProfileData(profileData: unknown): ParsedRouterProfile {
  const root = toRecord(profileData);
  const featureFlags = toRecord(root?.feature_flags);
  const memoryRouter = toRecord(featureFlags?.memory_router);

  const enabledRaw = memoryRouter?.enabled;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : false;

  const collectionRaw = memoryRouter?.default_collection ?? memoryRouter?.defaultCollection;
  const defaultCollection = typeof collectionRaw === 'string' && collectionRaw.trim().length > 0
    ? collectionRaw.trim()
    : DEFAULT_COLLECTION;

  return { enabled, defaultCollection };
}

function summarizeProfileForPrompt(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return 'No profile data available.';

  const entries = Object.entries(profile as Record<string, unknown>).slice(0, 8);
  if (entries.length === 0) return 'No profile data available.';

  const lines = entries.map(([key, value]) => {
    const serialized = typeof value === 'string'
      ? value
      : JSON.stringify(value);
    return `- ${key}: ${serialized}`;
  });
  return lines.join('\n');
}

function summarizeMemoryResults(results: Array<{ text: string; similarity: number }>): string {
  if (results.length === 0) return 'No matching memories found.';
  return results
    .slice(0, 5)
    .map((result, index) => `- [${index + 1}] (${result.similarity.toFixed(2)}) ${result.text}`)
    .join('\n');
}

function buildContextPreamble(params: {
  userContextData: unknown;
  memoryResults: Array<{ text: string; similarity: number }>;
}): string {
  const userContextData = toRecord(params.userContextData);
  const profile = userContextData?.profile;

  const sections = [
    'Epitome Memory Context (user-provided and previously observed):',
    '',
    'Profile Snapshot:',
    summarizeProfileForPrompt(profile),
    '',
    'Relevant Memories:',
    summarizeMemoryResults(params.memoryResults),
    '',
    'Use this context when relevant. If uncertain, state uncertainty.',
  ];

  return sections.join('\n').trim();
}

export class MemoryRouterServiceError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function loadMemoryRouterSettings(userId: string): Promise<MemoryRouterSettings> {
  const latestProfile = await getLatestProfile(userId);
  const parsed = parseRouterProfileData(latestProfile?.data ?? null);

  return {
    enabled: parsed.enabled,
    defaultCollection: parsed.defaultCollection,
  };
}

export async function saveMemoryRouterSettings(
  userId: string,
  changedBy: string,
  patch: { enabled?: boolean; defaultCollection?: string },
): Promise<MemoryRouterSettings> {
  const current = await loadMemoryRouterSettings(userId);
  const nextSettings: MemoryRouterSettings = {
    enabled: patch.enabled ?? current.enabled,
    defaultCollection: patch.defaultCollection ?? current.defaultCollection,
  };

  await ingestProfileUpdate({
    userId,
    changedBy,
    origin: 'user_typed',
    patch: {
      feature_flags: {
        memory_router: {
          enabled: nextSettings.enabled,
          default_collection: nextSettings.defaultCollection,
        },
      },
    },
  });

  return nextSettings;
}

export function ensureMemoryRouterEnabled(settings: MemoryRouterSettings): void {
  if (!settings.enabled) {
    throw new MemoryRouterServiceError(
      'FEATURE_DISABLED',
      'Memory Router is disabled for this user. Enable it in Settings first.',
      403,
    );
  }
}

export function parseMemoryRouterControlHeaders(
  headers: Headers,
  settings: MemoryRouterSettings,
): MemoryRouterControlHeaders {
  const modeHeader = headers.get('x-epitome-memory-mode');
  const mode = modeHeader === 'off' ? 'off' : 'auto';

  const collectionHeader = headers.get('x-epitome-memory-collection');
  const collection = collectionHeader?.trim() || settings.defaultCollection || DEFAULT_COLLECTION;
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(collection)) {
    throw new MemoryRouterServiceError(
      'INVALID_COLLECTION',
      'Invalid memory collection name. Use 1-100 chars: letters, numbers, dot, underscore, hyphen.',
      400,
    );
  }

  const idempotencyKey = headers.get('x-epitome-idempotency-key') || undefined;

  return {
    mode,
    collection,
    idempotencyKey,
  };
}

export async function prepareRoutedPayload(
  input: PrepareRoutedPayloadInput,
): Promise<PrepareRoutedPayloadOutput> {
  const { adapter, requestBody, toolContext, controlHeaders } = input;

  if (controlHeaders.mode === 'off') {
    return {
      requestBody,
      userQuery: adapter.extractUserQuery(requestBody),
      usedMemoryContext: false,
    };
  }

  const userQuery = adapter.extractUserQuery(requestBody);
  if (!userQuery) {
    return {
      requestBody,
      userQuery: null,
      usedMemoryContext: false,
    };
  }

  const contextResult = await getUserContext({ topic: userQuery }, toolContext);
  if (!contextResult.success) {
    if (contextResult.code === 'CONSENT_DENIED') {
      throw new MemoryRouterServiceError('CONSENT_DENIED', contextResult.message, 403);
    }
    logger.warn('memory_router getUserContext failed', {
      userId: toolContext.userId,
      agentId: toolContext.agentId,
      error: contextResult.message,
    });
    return {
      requestBody,
      userQuery,
      usedMemoryContext: false,
    };
  }

  const memoryResult = await searchMemory(
    {
      collection: controlHeaders.collection,
      query: userQuery,
      limit: 5,
      minSimilarity: 0.72,
    },
    toolContext,
  );

  if (!memoryResult.success) {
    if (memoryResult.code === 'CONSENT_DENIED') {
      throw new MemoryRouterServiceError('CONSENT_DENIED', memoryResult.message, 403);
    }
    logger.warn('memory_router searchMemory failed', {
      userId: toolContext.userId,
      agentId: toolContext.agentId,
      error: memoryResult.message,
    });
    return {
      requestBody,
      userQuery,
      usedMemoryContext: false,
    };
  }

  const memoryResults = memoryResult.data.results.map((result) => ({
    text: result.text,
    similarity: result.similarity,
  }));

  const preamble = buildContextPreamble({
    userContextData: contextResult.data,
    memoryResults,
  });

  const enrichedPayload = adapter.injectMemoryContext(requestBody, preamble);
  return {
    requestBody: enrichedPayload,
    userQuery,
    usedMemoryContext: true,
  };
}

export async function persistRoutedConversation(
  input: PersistConversationInput,
): Promise<void> {
  const { adapter, provider, requestBody, responseBody, assistantText, userQuery, toolContext, controlHeaders } = input;

  if (controlHeaders.mode === 'off') return;
  if (!userQuery) return;

  const responseText = assistantText
    ?? (responseBody ? adapter.extractAssistantTextFromJson(responseBody) : '');
  if (!responseText) return;

  const model = typeof requestBody.model === 'string' ? requestBody.model : 'unknown-model';
  const text = [
    `User: ${userQuery}`,
    '',
    `Assistant: ${responseText}`,
  ].join('\n');

  const metadata: Record<string, unknown> = {
    source: 'memory_router',
    provider,
    model,
    routedAt: new Date().toISOString(),
  };

  const saveResult = await saveMemory(
    {
      collection: controlHeaders.collection,
      text,
      metadata,
      idempotencyKey: controlHeaders.idempotencyKey,
    },
    toolContext,
  );

  if (!saveResult.success) {
    logger.warn('memory_router saveMemory failed', {
      userId: toolContext.userId,
      agentId: toolContext.agentId,
      code: saveResult.code,
      message: saveResult.message,
    });
  }
}
