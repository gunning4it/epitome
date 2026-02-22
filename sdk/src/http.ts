import {
  EpitomeServerError,
  createEpitomeError,
  type RateLimitInfo,
} from './errors.js';
import type { EpitomeClientConfig } from './types.js';

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class EpitomeHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeoutMs: number;

  constructor(config: EpitomeClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.defaultTimeoutMs = config.timeoutMs ?? 30_000;
  }

  async request<T>(options: HttpRequestOptions): Promise<T> {
    const url = buildUrl(this.baseUrl, options.path, options.query);
    const headers = buildHeaders({
      apiKey: this.apiKey,
      defaultHeaders: this.defaultHeaders,
      requestHeaders: options.headers,
      hasBody: options.body !== undefined,
    });

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    let timedOut = false;
    let onAbort: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        onAbort = () => controller.abort();
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const response = await this.fetchFn(url, {
        method: options.method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const parsed = parseJsonSafely(responseText);
      const responseHeaders = headersToObject(response.headers);
      const rateLimit = parseRateLimitHeaders(response.headers);

      if (!response.ok) {
        const { code, message, details } = parseErrorEnvelope(response.status, parsed);
        throw createEpitomeError(message, {
          status: response.status,
          code,
          details,
          headers: responseHeaders,
          rateLimit,
        });
      }

      if (!responseText) {
        return undefined as T;
      }

      if (parsed === undefined) {
        throw new EpitomeServerError('Expected JSON response from Epitome API', {
          status: response.status,
          code: 'INVALID_RESPONSE',
          headers: responseHeaders,
          rateLimit,
        });
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const message = timedOut
          ? `Request timed out after ${timeoutMs}ms`
          : 'Request was aborted';
        throw new EpitomeServerError(message, {
          status: 408,
          code: timedOut ? 'TIMEOUT' : 'ABORTED',
        });
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (options.signal && onAbort) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl ?? 'https://epitome.fyi').replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function buildHeaders(input: {
  apiKey: string;
  defaultHeaders: Record<string, string>;
  requestHeaders?: Record<string, string>;
  hasBody: boolean;
}): Headers {
  const merged = new Headers();

  for (const [key, value] of Object.entries(input.defaultHeaders)) {
    merged.set(key, value);
  }

  if (input.requestHeaders) {
    for (const [key, value] of Object.entries(input.requestHeaders)) {
      merged.set(key, value);
    }
  }

  if (!merged.has('x-api-key') && !merged.has('authorization')) {
    merged.set('X-API-Key', input.apiKey);
  }

  if (input.hasBody && !merged.has('content-type')) {
    merged.set('Content-Type', 'application/json');
  }

  return merged;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  const limit = toNumber(headers.get('x-ratelimit-limit'));
  const remaining = toNumber(headers.get('x-ratelimit-remaining'));
  const reset = toNumber(headers.get('x-ratelimit-reset'));
  const retryAfter = toNumber(headers.get('retry-after'));

  if (
    limit === undefined &&
    remaining === undefined &&
    reset === undefined &&
    retryAfter === undefined
  ) {
    return undefined;
  }

  return { limit, remaining, reset, retryAfter };
}

function toNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonSafely(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseErrorEnvelope(
  status: number,
  parsed: unknown,
): { code: string; message: string; details?: unknown } {
  if (!parsed || typeof parsed !== 'object') {
    return {
      code: `HTTP_${status}`,
      message: `Epitome API request failed with status ${status}`,
    };
  }

  const root = parsed as Record<string, unknown>;
  const error = root.error;
  if (!error || typeof error !== 'object') {
    return {
      code: `HTTP_${status}`,
      message: `Epitome API request failed with status ${status}`,
    };
  }

  const errObj = error as Record<string, unknown>;
  const code = typeof errObj.code === 'string' ? errObj.code : `HTTP_${status}`;
  const message = typeof errObj.message === 'string'
    ? errObj.message
    : `Epitome API request failed with status ${status}`;
  const details = errObj.details;

  return { code, message, details };
}
