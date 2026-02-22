import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from '@/hooks/useApi';
import { ApiError } from '@/lib/api-client';

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
const Billing = lazy(() => import('@/pages/Billing'));
const Settings = lazy(() => import('@/pages/Settings'));

// Docs pages — lazy loaded
const DocsLayout = lazy(() => import('@/components/docs/DocsLayout'));
const DocsIndex = lazy(() => import('@/pages/docs/DocsIndex'));
const QuickStart = lazy(() => import('@/pages/docs/QuickStart'));
const McpTools = lazy(() => import('@/pages/docs/McpTools'));
const ApiReference = lazy(() => import('@/pages/docs/ApiReference'));
const JavaScriptSdk = lazy(() => import('@/pages/docs/JavaScriptSdk'));
const JavaScriptSdkAiTools = lazy(() => import('@/pages/docs/JavaScriptSdkAiTools'));
const MemoryRouter = lazy(() => import('@/pages/docs/MemoryRouter'));
const SelfHosting = lazy(() => import('@/pages/docs/SelfHosting'));
const Architecture = lazy(() => import('@/pages/docs/Architecture'));
const DataModel = lazy(() => import('@/pages/docs/DataModel'));
const Contributing = lazy(() => import('@/pages/docs/Contributing'));
const Troubleshooting = lazy(() => import('@/pages/docs/Troubleshooting'));
const Security = lazy(() => import('@/pages/docs/Security'));
const BillingDocs = lazy(() => import('@/pages/docs/Billing'));

// Legal pages — lazy loaded
const LegalLayout = lazy(() => import('@/components/legal/LegalLayout'));
const PrivacyPolicy = lazy(() => import('@/pages/legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('@/pages/legal/TermsOfService'));
const SecurityCompliance = lazy(() => import('@/pages/legal/SecurityCompliance'));
const CookiePolicy = lazy(() => import('@/pages/legal/CookiePolicy'));
const CcpaPolicy = lazy(() => import('@/pages/legal/CcpaPolicy'));

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isLoading, error } = useSession();

  // Only show spinner on initial load (no cached data yet)
  if (isLoading && !session) {
    return <LoadingSpinner />;
  }

  // Redirect on auth-specific errors (401/403), even if stale data exists
  const isAuthError = error instanceof ApiError && (error.status === 401 || error.status === 403);
  if (isAuthError || (error && !session)) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/onboarding" element={<Onboarding />} />

      {/* Docs routes */}
      <Route path="/docs" element={<Suspense fallback={<LoadingSpinner />}><DocsLayout /></Suspense>}>
        <Route index element={<DocsIndex />} />
        <Route path="quick-start" element={<QuickStart />} />
        <Route path="mcp-tools" element={<McpTools />} />
        <Route path="api-reference" element={<ApiReference />} />
        <Route path="javascript-sdk" element={<JavaScriptSdk />} />
        <Route path="javascript-sdk-ai-tools" element={<JavaScriptSdkAiTools />} />
        <Route path="memory-router" element={<MemoryRouter />} />
        <Route path="self-hosting" element={<SelfHosting />} />
        <Route path="architecture" element={<Architecture />} />
        <Route path="data-model" element={<DataModel />} />
        <Route path="contributing" element={<Contributing />} />
        <Route path="troubleshooting" element={<Troubleshooting />} />
        <Route path="security" element={<Security />} />
        <Route path="billing" element={<BillingDocs />} />
      </Route>

      {/* Legal pages */}
      <Route path="/legal" element={<Suspense fallback={<LoadingSpinner />}><LegalLayout /></Suspense>}>
        <Route index element={<Navigate to="/legal/privacy" replace />} />
        <Route path="privacy" element={<PrivacyPolicy />} />
        <Route path="terms" element={<TermsOfService />} />
        <Route path="security" element={<SecurityCompliance />} />
        <Route path="cookies" element={<CookiePolicy />} />
        <Route path="ccpa" element={<CcpaPolicy />} />
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
        <Route path="/billing" element={<Billing />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
