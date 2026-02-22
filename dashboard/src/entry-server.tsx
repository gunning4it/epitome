import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Eagerly import public pages for SSR (no lazy loading)
import Landing from '@/pages/Landing';
import DocsLayout from '@/components/docs/DocsLayout';
import DocsIndex from '@/pages/docs/DocsIndex';
import QuickStart from '@/pages/docs/QuickStart';
import McpTools from '@/pages/docs/McpTools';
import ApiReference from '@/pages/docs/ApiReference';
import JavaScriptSdk from '@/pages/docs/JavaScriptSdk';
import JavaScriptSdkAiTools from '@/pages/docs/JavaScriptSdkAiTools';
import MemoryRouter from '@/pages/docs/MemoryRouter';
import SelfHosting from '@/pages/docs/SelfHosting';
import Architecture from '@/pages/docs/Architecture';
import DataModel from '@/pages/docs/DataModel';
import Contributing from '@/pages/docs/Contributing';
import Troubleshooting from '@/pages/docs/Troubleshooting';
import Security from '@/pages/docs/Security';
import BillingDocs from '@/pages/docs/Billing';

import LegalLayout from '@/components/legal/LegalLayout';
import PrivacyPolicy from '@/pages/legal/PrivacyPolicy';
import TermsOfService from '@/pages/legal/TermsOfService';
import SecurityCompliance from '@/pages/legal/SecurityCompliance';
import CookiePolicy from '@/pages/legal/CookiePolicy';
import CcpaPolicy from '@/pages/legal/CcpaPolicy';

import { Routes, Route, Navigate } from 'react-router-dom';

// Public-only routes for SSR — no auth-gated routes, no lazy loading
function PublicRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<DocsLayout />}>
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
      <Route path="/legal" element={<LegalLayout />}>
        <Route index element={<Navigate to="/legal/privacy" replace />} />
        <Route path="privacy" element={<PrivacyPolicy />} />
        <Route path="terms" element={<TermsOfService />} />
        <Route path="security" element={<SecurityCompliance />} />
        <Route path="cookies" element={<CookiePolicy />} />
        <Route path="ccpa" element={<CcpaPolicy />} />
      </Route>
    </Routes>
  );
}

export function render(url: string) {
  // QueryClient needed for hooks like useOptionalSession in LandingNav
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, enabled: false },
    },
  });

  const html = renderToString(
    <QueryClientProvider client={queryClient}>
      <StaticRouter location={url}>
        <PublicRoutes />
      </StaticRouter>
    </QueryClientProvider>
  );

  return { html };
}
