/**
 * Custom hooks for API calls using TanStack Query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Entity } from '@/lib/types';
import {
  profileApi,
  tablesApi,
  vectorsApi,
  graphApi,
  memoryApi,
  activityApi,
  agentsApi,
  authApi,
} from '@/lib/api-client';

// Auth hooks
export function useSession() {
  return useQuery({
    queryKey: ['auth', 'session'],
    queryFn: authApi.session,
    retry: false,
  });
}

// API key hooks
export function useApiKeys() {
  return useQuery({
    queryKey: ['auth', 'api-keys'],
    queryFn: authApi.listApiKeys,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.createApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.revokeApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'api-keys'] });
    },
  });
}

// Profile hooks
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: profileApi.get,
    refetchInterval: 30_000,
  });
}

export function useProfileHistory() {
  return useQuery({
    queryKey: ['profile', 'history'],
    queryFn: profileApi.history,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: profileApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// Tables hooks
export function useTables() {
  return useQuery({
    queryKey: ['tables'],
    queryFn: tablesApi.list,
    refetchInterval: 30_000,
  });
}

export function useTableData(tableName: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['tables', tableName, params],
    queryFn: () => tablesApi.query(tableName, params),
    enabled: !!tableName,
  });
}

export function useInsertRecord(tableName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => tablesApi.insert(tableName, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables', tableName] });
    },
  });
}

export function useUpdateRecord(tableName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      tablesApi.update(tableName, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables', tableName] });
    },
  });
}

export function useDeleteRecord(tableName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tablesApi.delete(tableName, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables', tableName] });
    },
  });
}

// Vector search hooks
export function useVectorSearch(
  collection: string,
  params: { query: string; limit?: number; minSimilarity?: number }
) {
  return useQuery({
    queryKey: ['vectors', collection, params],
    queryFn: () => vectorsApi.search(collection, params),
    enabled: !!collection && !!params.query,
  });
}

export function useRecentVectors(params?: { collection?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['vectors', 'recent', params],
    queryFn: () => vectorsApi.recent(params),
  });
}

export function useVectorCollections() {
  return useQuery({
    queryKey: ['vectors', 'collections'],
    queryFn: () => vectorsApi.collections(),
  });
}

// Graph hooks
export function useGraphEntities(params?: Record<string, string | number | boolean>) {
  return useQuery({
    queryKey: ['graph', 'entities', params],
    queryFn: () => graphApi.entities(params),
    refetchInterval: 30_000,
  });
}

export function useEntityNeighbors(entityId: string) {
  return useQuery({
    queryKey: ['graph', 'entity', entityId, 'neighbors'],
    queryFn: () => graphApi.neighbors(entityId),
    enabled: !!entityId,
  });
}

export function useUpdateEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Entity, 'name' | 'properties'>> }) =>
      graphApi.updateEntity(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}

export function useMergeEntities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      graphApi.mergeEntities(sourceId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}

export function useDeleteEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => graphApi.deleteEntity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}

// Memory review hooks
export function useMemoryReview() {
  return useQuery({
    queryKey: ['memory', 'review'],
    queryFn: memoryApi.review,
  });
}

export function useResolveReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'reject' | 'keep_both' }) =>
      memoryApi.resolve(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory', 'review'] });
    },
  });
}

// Activity log hooks
export function useActivityLog(params?: Record<string, string | number | boolean>) {
  return useQuery({
    queryKey: ['activity', params],
    queryFn: () => activityApi.list(params),
    refetchInterval: 30_000,
  });
}

// Agents/consent hooks
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      permissions,
    }: {
      agentId: string;
      permissions: Array<{ resource: string; permission: 'read' | 'write' | 'none' }>;
    }) => agentsApi.update(agentId, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useRevokeAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => agentsApi.revoke(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
