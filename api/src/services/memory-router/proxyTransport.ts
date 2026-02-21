import type { MemoryRouterProvider, ProviderAdapter } from '@/services/memory-router/types';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
export const MAX_PROXY_PAYLOAD_BYTES = 1_000_000; // 1 MB
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-openai-api-key',
  'x-anthropic-api-key',
  'x-epitome-api-key',
]);

export class MemoryRouterTransportError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function resolveUpstreamBaseUrl(provider: MemoryRouterProvider): string {
  if (provider === 'openai') {
    return process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  }
  return process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
}

function resolveUpstreamPath(provider: MemoryRouterProvider): string {
  if (provider === 'openai') return '/v1/chat/completions';
  return '/v1/messages';
}

function buildOpenAiHeaders(incomingHeaders: Headers): Headers {
  const headers = new Headers();
  const authHeader = incomingHeaders.get('authorization');
  const explicitKey = incomingHeaders.get('x-openai-api-key');

  if (explicitKey) {
    headers.set('authorization', `Bearer ${explicitKey}`);
  } else if (authHeader?.startsWith('Bearer ')) {
    headers.set('authorization', authHeader);
  } else {
    throw new MemoryRouterTransportError(
      'MISSING_PROVIDER_AUTH',
      'OpenAI provider auth required. Set Authorization Bearer or x-openai-api-key.',
      400,
    );
  }

  const org = incomingHeaders.get('openai-organization');
  if (org) headers.set('openai-organization', org);

  const project = incomingHeaders.get('openai-project');
  if (project) headers.set('openai-project', project);

  return headers;
}

function buildAnthropicHeaders(incomingHeaders: Headers): Headers {
  const headers = new Headers();
  const key = incomingHeaders.get('x-anthropic-api-key');
  if (!key) {
    throw new MemoryRouterTransportError(
      'MISSING_PROVIDER_AUTH',
      'Anthropic provider auth required. Set x-anthropic-api-key.',
      400,
    );
  }

  headers.set('x-api-key', key);
  headers.set(
    'anthropic-version',
    incomingHeaders.get('anthropic-version') || DEFAULT_ANTHROPIC_VERSION,
  );

  const beta = incomingHeaders.get('anthropic-beta');
  if (beta) headers.set('anthropic-beta', beta);

  return headers;
}

function buildUpstreamHeaders(provider: MemoryRouterProvider, incomingHeaders: Headers): Headers {
  const providerHeaders = provider === 'openai'
    ? buildOpenAiHeaders(incomingHeaders)
    : buildAnthropicHeaders(incomingHeaders);

  providerHeaders.set('content-type', 'application/json');
  providerHeaders.set('accept', incomingHeaders.get('accept') || 'application/json');
  return providerHeaders;
}

export function assertProxyPayloadSize(
  requestBody: Record<string, unknown>,
  maxBytes: number = MAX_PROXY_PAYLOAD_BYTES,
): number {
  const body = JSON.stringify(requestBody);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > maxBytes) {
    throw new MemoryRouterTransportError(
      'PAYLOAD_TOO_LARGE',
      `Request payload exceeds ${maxBytes} bytes.`,
      413,
    );
  }
  return bytes;
}

export async function forwardProviderRequest(params: {
  provider: MemoryRouterProvider;
  requestBody: Record<string, unknown>;
  incomingHeaders: Headers;
}): Promise<Response> {
  const { provider, requestBody, incomingHeaders } = params;

  const upstreamUrl = new URL(resolveUpstreamPath(provider), resolveUpstreamBaseUrl(provider)).toString();
  const headers = buildUpstreamHeaders(provider, incomingHeaders);

  try {
    return await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new MemoryRouterTransportError(
      'UPSTREAM_UNREACHABLE',
      `Failed to reach ${provider} upstream.`,
      502,
    );
  }
}

export function cloneUpstreamHeadersForClient(upstreamHeaders: Headers): Headers {
  const headers = new Headers(upstreamHeaders);
  // Remove hop-by-hop and unstable headers when constructing a new response.
  headers.delete('connection');
  headers.delete('transfer-encoding');
  headers.delete('keep-alive');
  headers.delete('proxy-authenticate');
  headers.delete('proxy-authorization');
  headers.delete('te');
  headers.delete('trailer');
  headers.delete('upgrade');
  headers.delete('content-length');
  return headers;
}

export function redactSensitiveHeaders(headers: Headers): Record<string, string> {
  const redacted: Record<string, string> = {};
  headers.forEach((value, key) => {
    redacted[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  });
  return redacted;
}

export async function collectAssistantTextFromSseStream(
  adapter: ProviderAdapter,
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const eventData = JSON.parse(payload);
          accumulated += adapter.extractAssistantTextFromStreamEvent(eventData);
        } catch {
          // Non-JSON SSE chunks are ignored for memory persistence.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated.trim();
}
