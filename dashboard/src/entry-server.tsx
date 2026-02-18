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
import SelfHosting from '@/pages/docs/SelfHosting';
import Architecture from '@/pages/docs/Architecture';
import DataModel from '@/pages/docs/DataModel';
import Contributing from '@/pages/docs/Contributing';
import Troubleshooting from '@/pages/docs/Troubleshooting';
import Security from '@/pages/docs/Security';

import { Routes, Route } from 'react-router-dom';

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
        <Route path="self-hosting" element={<SelfHosting />} />
        <Route path="architecture" element={<Architecture />} />
        <Route path="data-model" element={<DataModel />} />
        <Route path="contributing" element={<Contributing />} />
        <Route path="troubleshooting" element={<Troubleshooting />} />
        <Route path="security" element={<Security />} />
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
