import type { LucideIcon } from 'lucide-react';
import {
  Server,
  Brain,
  Network,
  Shield,
  Bot,
  Code2,
  DollarSign,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompetitorId = 'epitome' | 'mem0' | 'supermemory' | 'vertexrag';

export type CellValue =
  | { type: 'check' }
  | { type: 'cross' }
  | { type: 'text'; value: string }
  | { type: 'limited'; value?: string };

export interface Feature {
  name: string;
  values: Record<CompetitorId, CellValue>;
}

export interface FeatureCategory {
  name: string;
  icon: LucideIcon;
  features: Feature[];
}

export interface CompetitorInfo {
  id: CompetitorId;
  name: string;
  tagline: string;
  description: string;
  bullets: string[];
  url: string;
}

export interface ComparisonPageMeta {
  slug: string;
  primary: CompetitorId;
  secondary: CompetitorId;
  superlabel: string;
  title: string;
  subtitle: string;
  seo: {
    title: string;
    description: string;
  };
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export const COMPETITORS: Record<CompetitorId, CompetitorInfo> = {
  epitome: {
    id: 'epitome',
    name: 'Epitome',
    tagline: 'Your AI Memory Vault',
    description:
      'Open-source personal AI database with structured knowledge graph, confidence scoring, and per-user schema isolation.',
    bullets: [
      'Self-hostable PostgreSQL + pgvector',
      'Knowledge graph with entity extraction',
      'MCP-native with 9 tools',
    ],
    url: 'https://epitome.fyi',
  },
  mem0: {
    id: 'mem0',
    name: 'Mem0',
    tagline: 'Memory Layer for AI Apps',
    description:
      'Managed memory SaaS that provides a memory layer for LLM applications with automatic extraction and recall.',
    bullets: [
      'Managed cloud memory service',
      'Auto-extract from conversations',
      'REST API + Python/JS SDKs',
    ],
    url: 'https://mem0.ai',
  },
  supermemory: {
    id: 'supermemory',
    name: 'Supermemory',
    tagline: 'Bookmark Your Digital Life',
    description:
      'Open-source personal memory tool for saving bookmarks, notes, and web content with AI-powered search.',
    bullets: [
      'Browser extension for capture',
      'Open-source, self-hostable',
      'Semantic search over bookmarks',
    ],
    url: 'https://supermemory.ai',
  },
  vertexrag: {
    id: 'vertexrag',
    name: 'Vertex AI RAG',
    tagline: 'Enterprise RAG on Google Cloud',
    description:
      'Google Cloud\'s enterprise retrieval-augmented generation service for grounding LLMs with organizational data.',
    bullets: [
      'Google Cloud managed service',
      'Enterprise document indexing',
      'Grounding with Google Search',
    ],
    url: 'https://cloud.google.com/vertex-ai',
  },
};

// ---------------------------------------------------------------------------
// Feature categories & comparison matrix
// ---------------------------------------------------------------------------

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    name: 'Architecture',
    icon: Server,
    features: [
      {
        name: 'Self-hostable',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'check' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Open source',
        values: {
          epitome: { type: 'text', value: 'MIT' },
          mem0: { type: 'limited', value: 'Partial' },
          supermemory: { type: 'text', value: 'MIT' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Data storage',
        values: {
          epitome: { type: 'text', value: 'PostgreSQL + pgvector' },
          mem0: { type: 'text', value: 'Managed cloud' },
          supermemory: { type: 'text', value: 'SQLite + vectors' },
          vertexrag: { type: 'text', value: 'Google Cloud Storage' },
        },
      },
      {
        name: 'Per-user isolation',
        values: {
          epitome: { type: 'text', value: 'Schema-level' },
          mem0: { type: 'text', value: 'API key scoped' },
          supermemory: { type: 'text', value: 'User-level' },
          vertexrag: { type: 'text', value: 'Project-level' },
        },
      },
    ],
  },
  {
    name: 'Memory Model',
    icon: Brain,
    features: [
      {
        name: 'Structured profile',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Confidence scoring',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Memory lifecycle',
        values: {
          epitome: { type: 'text', value: 'Promote / demote / decay' },
          mem0: { type: 'text', value: 'Create / delete' },
          supermemory: { type: 'text', value: 'Save / delete' },
          vertexrag: { type: 'text', value: 'Index / remove' },
        },
      },
      {
        name: 'Semantic search',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'check' },
          supermemory: { type: 'check' },
          vertexrag: { type: 'check' },
        },
      },
      {
        name: 'Contradiction detection',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
    ],
  },
  {
    name: 'Knowledge Graph',
    icon: Network,
    features: [
      {
        name: 'Entity extraction',
        values: {
          epitome: { type: 'text', value: '3 methods (LLM + NER + pattern)' },
          mem0: { type: 'limited', value: 'Basic' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Typed relationships',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'limited' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Graph traversal queries',
        values: {
          epitome: { type: 'text', value: 'Recursive CTE' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Entity deduplication',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
    ],
  },
  {
    name: 'Privacy & Control',
    icon: Shield,
    features: [
      {
        name: 'Consent system',
        values: {
          epitome: { type: 'text', value: 'Per-tool granular' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'text', value: 'IAM roles' },
        },
      },
      {
        name: 'Audit logging',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'limited' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'check' },
        },
      },
      {
        name: 'Data export',
        values: {
          epitome: { type: 'text', value: 'Full SQL dump' },
          mem0: { type: 'text', value: 'API export' },
          supermemory: { type: 'text', value: 'JSON export' },
          vertexrag: { type: 'text', value: 'GCS bucket' },
        },
      },
      {
        name: 'GDPR compliance',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'check' },
          supermemory: { type: 'limited' },
          vertexrag: { type: 'check' },
        },
      },
    ],
  },
  {
    name: 'Agent Support',
    icon: Bot,
    features: [
      {
        name: 'MCP protocol',
        values: {
          epitome: { type: 'text', value: '9 tools, Streamable HTTP' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Multi-agent memory',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'check' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'limited' },
        },
      },
      {
        name: 'Context budget ranking',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
      {
        name: 'Memory router (LLM proxy)',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
    ],
  },
  {
    name: 'Developer Experience',
    icon: Code2,
    features: [
      {
        name: 'REST API',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'check' },
          supermemory: { type: 'check' },
          vertexrag: { type: 'check' },
        },
      },
      {
        name: 'JavaScript SDK',
        values: {
          epitome: { type: 'check' },
          mem0: { type: 'check' },
          supermemory: { type: 'check' },
          vertexrag: { type: 'text', value: 'Python only' },
        },
      },
      {
        name: 'Dashboard UI',
        values: {
          epitome: { type: 'text', value: 'Full React SPA' },
          mem0: { type: 'text', value: 'Basic web UI' },
          supermemory: { type: 'text', value: 'Browser extension' },
          vertexrag: { type: 'text', value: 'GCP Console' },
        },
      },
      {
        name: 'Graph visualization',
        values: {
          epitome: { type: 'text', value: 'D3.js interactive' },
          mem0: { type: 'cross' },
          supermemory: { type: 'cross' },
          vertexrag: { type: 'cross' },
        },
      },
    ],
  },
  {
    name: 'Pricing',
    icon: DollarSign,
    features: [
      {
        name: 'Free tier',
        values: {
          epitome: { type: 'text', value: 'Unlimited (self-host)' },
          mem0: { type: 'text', value: '1K memories' },
          supermemory: { type: 'text', value: 'Unlimited (self-host)' },
          vertexrag: { type: 'text', value: 'GCP free tier' },
        },
      },
      {
        name: 'Hosted pricing',
        values: {
          epitome: { type: 'text', value: 'From $0/mo' },
          mem0: { type: 'text', value: 'From $99/mo' },
          supermemory: { type: 'text', value: 'From $10/mo' },
          vertexrag: { type: 'text', value: 'Pay-per-query' },
        },
      },
      {
        name: 'Vendor lock-in',
        values: {
          epitome: { type: 'text', value: 'None' },
          mem0: { type: 'text', value: 'High' },
          supermemory: { type: 'text', value: 'Low' },
          vertexrag: { type: 'text', value: 'Google Cloud' },
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Per-page comparison metadata
// ---------------------------------------------------------------------------

export const COMPARISON_PAGES: ComparisonPageMeta[] = [
  {
    slug: 'mem0',
    primary: 'mem0',
    secondary: 'supermemory',
    superlabel: 'Memory Platform Showdown',
    title: 'Epitome vs Mem0 vs Supermemory',
    subtitle:
      'Three-way comparison of open-source knowledge graph, managed memory SaaS, and bookmark-based memory. Schema isolation, MCP tools, consent systems, and pricing side by side.',
    seo: {
      title: 'Epitome vs Mem0 vs Supermemory \u2014 AI Memory Platform Comparison 2026',
      description:
        'Epitome vs Mem0 vs Supermemory compared side by side. Self-hosted knowledge graph vs managed memory SaaS vs bookmark memory. Schema isolation, MCP tools, consent system, and pricing analyzed.',
    },
  },
  {
    slug: 'supermemory',
    primary: 'supermemory',
    secondary: 'vertexrag',
    superlabel: 'Personal Memory Face-Off',
    title: 'Epitome vs Supermemory vs Vertex AI RAG',
    subtitle:
      'Three-way comparison of structured identity layer, bookmark memory, and enterprise RAG. Architecture, agent support, self-hosting, and pricing side by side.',
    seo: {
      title: 'Epitome vs Supermemory vs Vertex AI RAG \u2014 Personal AI Memory Compared 2026',
      description:
        'Epitome vs Supermemory vs Vertex AI RAG compared side by side. Structured identity layer vs bookmark memory vs enterprise RAG. Architecture, agent support, and self-hosting analyzed.',
    },
  },
  {
    slug: 'vertexrag',
    primary: 'vertexrag',
    secondary: 'mem0',
    superlabel: 'Memory Vault vs Enterprise RAG',
    title: 'Epitome vs Vertex AI RAG vs Mem0',
    subtitle:
      'Three-way comparison of personal memory vault, enterprise document retrieval, and managed memory SaaS. Privacy, cost, vendor independence, and architecture side by side.',
    seo: {
      title: 'Epitome vs Vertex AI RAG vs Mem0 \u2014 Memory Vault vs Enterprise RAG 2026',
      description:
        'Epitome vs Vertex AI RAG vs Mem0 compared side by side. Personal memory vault with confidence scoring vs enterprise document retrieval vs managed SaaS. Privacy, cost, and vendor independence analyzed.',
    },
  },
];

export const HUB_SEO = {
  title: 'Compare Epitome \u2014 AI Memory Alternatives | Mem0, Supermemory, Vertex RAG',
  description:
    'See how Epitome\u2019s open-source AI memory vault compares to Mem0, Supermemory, and Vertex AI RAG. Feature-by-feature comparison of memory architecture, knowledge graph, privacy, and pricing.',
};

// ---------------------------------------------------------------------------
// Key differences (prose blocks for individual pages)
// ---------------------------------------------------------------------------

export interface KeyDifference {
  heading: string;
  body: string;
}

export const KEY_DIFFERENCES: Record<string, KeyDifference[]> = {
  mem0: [
    {
      heading: 'Self-hosted vs managed SaaS',
      body: 'Epitome runs on your own PostgreSQL instance with full schema isolation per user. Mem0 is a managed cloud service where your memory data lives on their infrastructure. With Epitome, you own your data pipeline end-to-end.',
    },
    {
      heading: 'Knowledge graph vs flat memory',
      body: 'Epitome builds a structured knowledge graph with typed entities, weighted relationships, and recursive traversal. Mem0 stores memories as flat key-value pairs with basic tagging. The graph lets agents reason about connections between people, places, and concepts.',
    },
    {
      heading: 'Confidence scoring vs binary state',
      body: 'Every memory in Epitome has a confidence score that increases through reinforcement and decays over time. Mem0 memories are either stored or deleted. Confidence scoring means agents naturally prioritize trustworthy information.',
    },
  ],
  supermemory: [
    {
      heading: 'AI memory vault vs bookmark tool',
      body: 'Epitome is purpose-built for AI agents — structured profiles, semantic memory, and a knowledge graph that agents query directly. Supermemory focuses on saving bookmarks and web content for personal reference. Different tools for different jobs.',
    },
    {
      heading: 'MCP-native vs REST-only',
      body: 'Epitome speaks MCP natively with 9 specialized tools over Streamable HTTP transport. Supermemory exposes a REST API. MCP means any compatible AI agent can discover and use Epitome\'s capabilities automatically.',
    },
    {
      heading: 'Memory quality engine',
      body: 'Epitome\'s promote/demote state machine, contradiction detection, and nightly decay create a self-curating memory system. Supermemory stores what you save, as-is. Quality scoring means your AI context stays clean and trustworthy over time.',
    },
  ],
  vertexrag: [
    {
      heading: 'Personal identity vs document retrieval',
      body: 'Epitome builds a persistent identity layer for individuals — profiles, preferences, relationships, and episodic memory. Vertex AI RAG indexes enterprise documents for retrieval. Epitome remembers who you are; Vertex RAG retrieves what you wrote.',
    },
    {
      heading: 'Open source vs cloud-locked',
      body: 'Epitome is MIT-licensed and runs anywhere Docker does. Vertex AI RAG is a proprietary Google Cloud service requiring a GCP project, billing account, and vendor commitment. Switching away from Vertex means rebuilding your entire pipeline.',
    },
    {
      heading: 'Consent-first vs IAM-only',
      body: 'Epitome\'s granular consent system lets users control exactly which tools each agent can access, with a full audit trail. Vertex RAG relies on GCP IAM — powerful for enterprises, but not designed for individual user consent. Epitome puts the user in control.',
    },
  ],
};
