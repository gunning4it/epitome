/**
 * Memory Router Routes
 *
 * Proxy endpoints for provider calls with memory augmentation.
 */

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { HonoEnv } from '@/types/hono';
import { requireAuth, requireUser } from '@/middleware/auth';
import { expensiveOperationRateLimit } from '@/middleware/rateLimit';
import { logAuditEntry } from '@/services/audit.service';
import { buildToolContext } from '@/services/tools/context';
import type { AuthType, Tier } from '@/services/tools/types';
import { getProviderAdapter } from '@/services/memory-router/providers';
import {
  MemoryRouterServiceError,
  ensureMemoryRouterEnabled,
  loadMemoryRouterSettings,
  parseMemoryRouterControlHeaders,
  persistRoutedConversation,
  prepareRoutedPayload,
  saveMemoryRouterSettings,
} from '@/services/memory-router/memoryRouter.service';
import {
  MemoryRouterTransportError,
  assertProxyPayloadSize,
  cloneUpstreamHeadersForClient,
  collectAssistantTextFromSseStream,
  forwardProviderRequest,
  redactSensitiveHeaders,
} from '@/services/memory-router/proxyTransport';
import type { MemoryRouterProvider } from '@/services/memory-router/types';
import { logger } from '@/utils/logger';
import {
  memoryRouterOpenAiSchema,
  memoryRouterAnthropicSchema,
  memoryRouterSettingsPatchSchema,
} from '@/validators/api';

const memoryRouter = new Hono<HonoEnv>();

function assertNoUpstreamOverride(headers: Headers, body: Record<string, unknown>): void {
  const overrideHeader = headers.get('x-upstream-url')
    || headers.get('x-target-url')
    || headers.get('x-provider-base-url');
  if (overrideHeader) {
    throw new MemoryRouterTransportError(
      'UPSTREAM_OVERRIDE_BLOCKED',
      'Client-supplied upstream URL overrides are not allowed.',
      400,
    );
  }

  const blockedBodyKeys = ['upstream_url', 'target_url', 'provider_base_url', 'provider_path'];
  for (const key of blockedBodyKeys) {
    if (Object.hasOwn(body, key)) {
      throw new MemoryRouterTransportError(
        'UPSTREAM_OVERRIDE_BLOCKED',
        'Client-supplied upstream URL overrides are not allowed.',
        400,
      );
    }
  }
}

function toErrorStatus(status: number): 400 | 403 | 413 | 500 | 502 {
  if (status === 400 || status === 403 || status === 413 || status === 502) return status;
  return 500;
}

async function proxyProviderRequest(
  c: Context<HonoEnv>,
  provider: MemoryRouterProvider,
  requestBody: Record<string, unknown>,
) {
  const userId = c.get('userId') as string;
  const tier = (c.get('tier') || 'free') as Tier;
  const agentId = String(c.get('agentId') || 'user');
  const authType = (c.get('authType') || 'api_key') as AuthType;

  try {
    const adapter = getProviderAdapter(provider);
    assertNoUpstreamOverride(c.req.raw.headers, requestBody);

    logger.debug('memory_router request', {
      provider,
      userId,
      agentId,
      headers: redactSensitiveHeaders(c.req.raw.headers),
    });

    const settings = await loadMemoryRouterSettings(userId);
    ensureMemoryRouterEnabled(settings);

    const controlHeaders = parseMemoryRouterControlHeaders(c.req.raw.headers, settings);
    const startedAt = Date.now();
    const toolContext = buildToolContext({
      userId,
      agentId,
      tier,
      authType,
    });

    const prepared = await prepareRoutedPayload({
      adapter,
      requestBody,
      toolContext,
      controlHeaders,
    });

    assertProxyPayloadSize(prepared.requestBody);

    const upstreamResponse = await forwardProviderRequest({
      provider,
      requestBody: prepared.requestBody,
      incomingHeaders: c.req.raw.headers,
    });
    const responseHeaders = cloneUpstreamHeadersForClient(upstreamResponse.headers);
    const isSseResponse = (upstreamResponse.headers.get('content-type') || '')
      .toLowerCase()
      .includes('text/event-stream');

    if (isSseResponse && upstreamResponse.body) {
      const [clientStream, captureStream] = upstreamResponse.body.tee();

      if (upstreamResponse.ok) {
        void collectAssistantTextFromSseStream(adapter, captureStream)
          .then(async (assistantText) => {
            await persistRoutedConversation({
              provider,
              adapter,
              requestBody,
              assistantText,
              userQuery: prepared.userQuery,
              toolContext,
              controlHeaders,
            });
          })
          .catch((error: unknown) => {
            logger.warn('memory_router stream capture failed', {
              provider,
              userId,
              error: String(error),
            });
          });
      }

      void logAuditEntry(userId, {
        agentId,
        action: 'read',
        resource: `memory_router/${provider}`,
        details: {
          mode: controlHeaders.mode,
          usedMemoryContext: prepared.usedMemoryContext,
          upstreamStatus: upstreamResponse.status,
          latencyMs: Date.now() - startedAt,
          stream: true,
        },
      }).catch(() => {});

      return new Response(clientStream, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    const responseText = await upstreamResponse.text();
    let parsedResponse: unknown = undefined;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      parsedResponse = undefined;
    }

    if (upstreamResponse.ok) {
      void persistRoutedConversation({
        provider,
        adapter,
        requestBody,
        responseBody: parsedResponse,
        userQuery: prepared.userQuery,
        toolContext,
        controlHeaders,
      }).catch((error: unknown) => {
        logger.warn('memory_router post-save failed', {
          provider,
          userId,
          error: String(error),
        });
      });
    }

    void logAuditEntry(userId, {
      agentId,
      action: 'read',
      resource: `memory_router/${provider}`,
      details: {
        mode: controlHeaders.mode,
        usedMemoryContext: prepared.usedMemoryContext,
        upstreamStatus: upstreamResponse.status,
        latencyMs: Date.now() - startedAt,
        stream: false,
      },
    }).catch(() => {});

    return new Response(responseText, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof MemoryRouterServiceError || error instanceof MemoryRouterTransportError) {
      void logAuditEntry(userId, {
        agentId,
        action: 'read',
        resource: `memory_router/${provider}`,
        details: {
          errorCode: error.code,
          errorMessage: error.message,
        },
      }).catch(() => {});

      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: toErrorStatus(error.status) },
      );
    }

    logger.error('memory_router proxy failure', {
      provider,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Memory Router request failed',
        },
      },
      500,
    );
  }
}

memoryRouter.post(
  '/openai/v1/chat/completions',
  requireAuth,
  expensiveOperationRateLimit,
  zValidator('json', memoryRouterOpenAiSchema),
  async (c) => proxyProviderRequest(c, 'openai', c.req.valid('json') as Record<string, unknown>),
);

memoryRouter.post(
  '/anthropic/v1/messages',
  requireAuth,
  expensiveOperationRateLimit,
  zValidator('json', memoryRouterAnthropicSchema),
  async (c) => proxyProviderRequest(c, 'anthropic', c.req.valid('json') as Record<string, unknown>),
);

memoryRouter.get('/settings', requireAuth, requireUser, async (c) => {
  const userId = c.get('userId') as string;
  const settings = await loadMemoryRouterSettings(userId);

  await logAuditEntry(userId, {
    agentId: 'user',
    action: 'read',
    resource: 'memory_router/settings',
    details: {},
  });

  return c.json({
    data: {
      enabled: settings.enabled,
      defaultCollection: settings.defaultCollection,
    },
    meta: {},
  });
});

memoryRouter.patch(
  '/settings',
  requireAuth,
  requireUser,
  zValidator('json', memoryRouterSettingsPatchSchema),
  async (c) => {
    const userId = c.get('userId') as string;
    const { body } = c.req.valid('json');

    const settings = await saveMemoryRouterSettings(userId, 'user', {
      enabled: body.enabled,
      defaultCollection: body.defaultCollection,
    });

    await logAuditEntry(userId, {
      agentId: 'user',
      action: 'write',
      resource: 'memory_router/settings',
      details: {
        enabled: settings.enabled,
        defaultCollection: settings.defaultCollection,
      },
    });

    return c.json({
      data: {
        enabled: settings.enabled,
        defaultCollection: settings.defaultCollection,
      },
      meta: {},
    });
  }
);

export default memoryRouter;
