import { EpitomeValidationError } from '../errors.js';
import { EpitomeHttpClient } from '../http.js';
import type {
  GetProfileResult,
  UpdateProfileInput,
  UpdateProfileResult,
} from '../types.js';

interface GetProfileResponseEnvelope {
  data: Record<string, unknown>;
  version: number;
  updated_at: string;
}

interface UpdateProfileResponseEnvelope {
  data: {
    version: number;
    data: Record<string, unknown>;
    changedFields: string[];
    changedAt: string;
    sourceRef: string;
    writeId: string;
    writeStatus: string;
    jobId: string | null;
  };
}

export async function getProfileMethod(
  http: EpitomeHttpClient,
): Promise<GetProfileResult> {
  const response = await http.request<GetProfileResponseEnvelope>({
    method: 'GET',
    path: '/profile',
  });

  return {
    data: response.data,
    version: response.version,
    updatedAt: response.updated_at,
  };
}

export async function updateProfileMethod(
  http: EpitomeHttpClient,
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
    throw new EpitomeValidationError('updateProfile.patch must be an object', {
      status: 400,
      code: 'INVALID_ARGS',
    });
  }

  const response = await http.request<UpdateProfileResponseEnvelope>({
    method: 'PATCH',
    path: '/profile',
    body: {
      body: input.patch,
    },
  });

  return response.data;
}
