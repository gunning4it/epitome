/**
 * Pre-render public routes to static HTML for SEO.
 *
 * Uses Vite's SSR mode to load entry-server.tsx, then renders each public
 * route to HTML and writes it to dist/[path]/index.html.
 *
 * Run after `vite build` and `vite build --ssr`:
 *   node --import tsx scripts/prerender.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const serverDir = path.resolve(__dirname, '../dist/server');

/** Public routes to pre-render. */
const PUBLIC_ROUTES = [
  '/',
  '/docs',
  '/docs/quick-start',
  '/docs/mcp-tools',
  '/docs/api-reference',
  '/docs/javascript-sdk',
  '/docs/javascript-sdk-ai-tools',
  '/docs/memory-router',
  '/docs/billing',
  '/docs/self-hosting',
  '/docs/architecture',
  '/docs/data-model',
  '/docs/security',
  '/docs/contributing',
  '/docs/troubleshooting',
  '/comparison',
  '/comparison/mem0',
  '/comparison/supermemory',
  '/comparison/vertexrag',
];

/** Per-route metadata for <head> injection. */
const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Epitome — Your AI Memory Vault',
    description: 'The portable identity layer that gives every AI agent a shared, persistent memory of you. Open source. Self-hostable. Yours.',
  },
  '/docs': {
    title: 'Documentation — Epitome',
    description: 'Everything you need to build with Epitome — quick start, API reference, and MCP tools.',
  },
  '/docs/quick-start': {
    title: 'Quick Start — Epitome Docs',
    description: 'Get Epitome running and connect your first AI agent in under 2 minutes.',
  },
  '/docs/mcp-tools': {
    title: 'MCP Tools Reference — Epitome Docs',
    description: '9 MCP tools for AI agent integration — read_profile, store_memory, query_graph, and more.',
  },
  '/docs/api-reference': {
    title: 'API Reference — Epitome Docs',
    description: '22 REST endpoints for programmatic access to your personal AI database.',
  },
  '/docs/javascript-sdk': {
    title: 'JavaScript SDK — Epitome Docs',
    description: 'Build with Epitome using @epitomefyi/sdk, the official TypeScript client.',
  },
  '/docs/javascript-sdk-ai-tools': {
    title: 'AI SDK Tools — Epitome Docs',
    description: 'Use searchMemory, saveMemory, and getUserContext with Vercel AI SDK tool calling.',
  },
  '/docs/memory-router': {
    title: 'Memory Router (LLM Proxy) — Epitome Docs',
    description: 'Proxy OpenAI and Anthropic calls through Epitome for automatic memory retrieval and save.',
  },
  '/docs/billing': {
    title: 'Billing & Agents — Epitome Docs',
    description: 'Plans, pricing, and x402-based payments for autonomous agents.',
  },
  '/docs/self-hosting': {
    title: 'Self-Hosting Guide — Epitome Docs',
    description: 'Deploy your own Epitome instance with Docker Compose or manual setup.',
  },
  '/docs/architecture': {
    title: 'Architecture — Epitome Docs',
    description: 'System design, tech stack, and key architectural decisions behind Epitome.',
  },
  '/docs/data-model': {
    title: 'Data Model — Epitome Docs',
    description: 'Database schema, JSONB contracts, and table definitions.',
  },
  '/docs/security': {
    title: 'Security Model — Epitome Docs',
    description: 'Authentication, schema isolation, consent system, and audit logging.',
  },
  '/docs/contributing': {
    title: 'Contributing — Epitome Docs',
    description: 'Development setup, PR process, and contribution guidelines.',
  },
  '/docs/troubleshooting': {
    title: 'Troubleshooting — Epitome Docs',
    description: 'Common issues, FAQ, and debugging tips.',
  },
  '/comparison': {
    title: 'Compare Epitome — AI Memory Alternatives | Mem0, Supermemory, Vertex RAG',
    description: 'See how Epitome\u2019s open-source AI memory vault compares to Mem0, Supermemory, and Vertex AI RAG. Feature-by-feature comparison of memory architecture, knowledge graph, privacy, and pricing.',
  },
  '/comparison/mem0': {
    title: 'Epitome vs Mem0 vs Supermemory — AI Memory Platform Comparison 2026',
    description: 'Epitome vs Mem0 vs Supermemory compared side by side. Self-hosted knowledge graph vs managed memory SaaS vs bookmark memory. Schema isolation, MCP tools, consent system, and pricing analyzed.',
  },
  '/comparison/supermemory': {
    title: 'Epitome vs Supermemory vs Vertex AI RAG — Personal AI Memory Compared 2026',
    description: 'Epitome vs Supermemory vs Vertex AI RAG compared side by side. Structured identity layer vs bookmark memory vs enterprise RAG. Architecture, agent support, and self-hosting analyzed.',
  },
  '/comparison/vertexrag': {
    title: 'Epitome vs Vertex AI RAG vs Mem0 — Memory Vault vs Enterprise RAG 2026',
    description: 'Epitome vs Vertex AI RAG vs Mem0 compared side by side. Personal memory vault with confidence scoring vs enterprise document retrieval vs managed SaaS. Privacy, cost, and vendor independence analyzed.',
  },
};

async function prerender() {
  // Read the client-built index.html as template
  const templatePath = path.join(distDir, 'index.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Error: dist/index.html not found. Run `vite build` first.');
    process.exit(1);
  }
  const template = fs.readFileSync(templatePath, 'utf-8');

  // Load the SSR module
  const serverEntry = path.join(serverDir, 'entry-server.js');
  if (!fs.existsSync(serverEntry)) {
    console.error('Error: dist/server/entry-server.js not found. Run `vite build --ssr` first.');
    process.exit(1);
  }
  const { render } = await import(serverEntry);

  console.log(`Pre-rendering ${PUBLIC_ROUTES.length} routes...\n`);

  for (const route of PUBLIC_ROUTES) {
    const { html: appHtml } = render(route);
    const meta = ROUTE_META[route];

    // Inject rendered HTML into template
    let page = template.replace(
      '<div id="root"></div>',
      `<div id="root">${appHtml}</div>`
    );

    // Inject per-route meta into <head> using regex for precision
    if (meta) {
      const canonicalUrl = `https://epitome.fyi${route === '/' ? '' : route}`;

      // Title tag
      page = page.replace(
        /<title>[^<]*<\/title>/,
        `<title>${meta.title}</title>`
      );

      // meta description
      page = page.replace(
        /(<meta name="description" content=")[^"]*(")/,
        `$1${meta.description}$2`
      );

      // og:title
      page = page.replace(
        /(<meta property="og:title" content=")[^"]*(")/,
        `$1${meta.title}$2`
      );

      // og:description
      page = page.replace(
        /(<meta property="og:description" content=")[^"]*(")/,
        `$1${meta.description}$2`
      );

      // og:url
      page = page.replace(
        /(<meta property="og:url" content=")[^"]*(")/,
        `$1${canonicalUrl}$2`
      );

      // twitter:title
      page = page.replace(
        /(<meta name="twitter:title" content=")[^"]*(")/,
        `$1${meta.title}$2`
      );

      // twitter:description
      page = page.replace(
        /(<meta name="twitter:description" content=")[^"]*(")/,
        `$1${meta.description}$2`
      );

      // canonical URL
      page = page.replace(
        /(<link rel="canonical" href=")[^"]*(")/,
        `$1${canonicalUrl}$2`
      );
    }

    // Write to dist/[route]/index.html
    const outDir = route === '/'
      ? distDir
      : path.join(distDir, route);

    fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, 'index.html');
    fs.writeFileSync(outPath, page);
    console.log(`  ${route} → ${path.relative(distDir, outPath)}`);
  }

  console.log('\nPre-rendering complete.');
}

prerender().catch((err) => {
  console.error('Pre-render failed:', err);
  process.exit(1);
});
