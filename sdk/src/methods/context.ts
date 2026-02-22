import { EpitomeHttpClient } from '../http.js';
import type {
  GetUserContextInput,
  GetUserContextResult,
} from '../types.js';

interface GetUserContextResponseEnvelope {
  data: GetUserContextResult;
  meta: {
    message: string;
    warnings?: string[];
  };
}

export async function getUserContextMethod(
  http: EpitomeHttpClient,
  input: GetUserContextInput = {},
): Promise<GetUserContextResult> {
  const response = await http.request<GetUserContextResponseEnvelope>({
    method: 'GET',
    path: '/profile/context',
    query: {
      topic: input.topic,
    },
  });

  return response.data;
}
