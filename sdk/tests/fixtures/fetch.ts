export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

export function createFetchMock(
  handler: (request: RecordedRequest) => Response | Promise<Response>,
) {
  const requests: RecordedRequest[] = [];

  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = normalizeRequestUrl(input);
    const request: RecordedRequest = { url, init };
    requests.push(request);
    return handler(request);
  };

  return { fetchMock, requests };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

function normalizeRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
