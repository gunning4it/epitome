import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from '@/hooks/useApi';

// Layout
import DashboardLayout from '@/components/DashboardLayout';

// Landing page — eagerly loaded (first paint for new visitors)
import Landing from '@/pages/Landing';

// Onboarding — eagerly loaded (auth flow)
import Onboarding from '@/pages/Onboarding';

// Dashboard pages — lazy loaded
const Profile = lazy(() => import('@/pages/Profile'));
const Tables = lazy(() => import('@/pages/Tables'));
const Memories = lazy(() => import('@/pages/Memories'));
const Graph = lazy(() => import('@/pages/Graph'));
const Review = lazy(() => import('@/pages/Review'));
const Activity = lazy(() => import('@/pages/Activity'));
const Agents = lazy(() => import('@/pages/Agents'));
const Settings = lazy(() => import('@/pages/Settings'));

// Docs pages — lazy loaded
const DocsLayout = lazy(() => import('@/components/docs/DocsLayout'));
const DocsIndex = lazy(() => import('@/pages/docs/DocsIndex'));
const QuickStart = lazy(() => import('@/pages/docs/QuickStart'));
const McpTools = lazy(() => import('@/pages/docs/McpTools'));
const ApiReference = lazy(() => import('@/pages/docs/ApiReference'));
const SelfHosting = lazy(() => import('@/pages/docs/SelfHosting'));
const Architecture = lazy(() => import('@/pages/docs/Architecture'));
const DataModel = lazy(() => import('@/pages/docs/DataModel'));
const Contributing = lazy(() => import('@/pages/docs/Contributing'));
const Troubleshooting = lazy(() => import('@/pages/docs/Troubleshooting'));
const Security = lazy(() => import('@/pages/docs/Security'));

// Create query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, error } = useSession();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/onboarding" element={<Onboarding />} />

            {/* Docs routes */}
            <Route path="/docs" element={<DocsLayout />}>
              <Route index element={<DocsIndex />} />
              <Route path="quick-start" element={<QuickStart />} />
              <Route path="mcp-tools" element={<McpTools />} />
              <Route path="api-reference" element={<ApiReference />} />
              <Route path="self-hosting" element={<SelfHosting />} />
              <Route path="architecture" element={<Architecture />} />
              <Route path="data-model" element={<DataModel />} />
              <Route path="contributing" element={<Contributing />} />
              <Route path="troubleshooting" element={<Troubleshooting />} />
              <Route path="security" element={<Security />} />
            </Route>

            {/* Auth-gated dashboard routes */}
            <Route element={<AuthGuard><DashboardLayout /></AuthGuard>}>
              <Route path="/profile" element={<Profile />} />
              <Route path="/tables" element={<Tables />} />
              <Route path="/memories" element={<Memories />} />
              <Route path="/graph" element={<Graph />} />
              <Route path="/review" element={<Review />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
