import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api-client';

/**
 * Like useSession but doesn't redirect on 401.
 * Used by landing page to show "Dashboard" vs "Get Started" buttons.
 */
export function useOptionalSession() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: authApi.session,
    retry: false,
  });

  return {
    session: data ?? null,
    isLoading,
    isAuthenticated: !!data,
  };
}
