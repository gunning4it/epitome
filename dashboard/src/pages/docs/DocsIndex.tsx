import { Link } from 'react-router-dom';
import {
  Rocket,
  Wrench,
  Code,
  Package,
  Bot,
  Route,
  Server,
  Layers,
  Database,
  Shield,
  CreditCard,
  GitPullRequest,
  HelpCircle,
} from 'lucide-react';
import DocPage from '@/components/docs/DocPage';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const sections = [
  {
    title: 'Quick Start',
    description: 'Get up and running in under 2 minutes',
    icon: Rocket,
    path: '/docs/quick-start',
    color: 'text-green-400',
  },
  {
    title: 'MCP Tools',
    description: '9 MCP tools for AI agent integration',
    icon: Wrench,
    path: '/docs/mcp-tools',
    color: 'text-blue-400',
  },
  {
    title: 'API Reference',
    description: '22 REST endpoints for programmatic access',
    icon: Code,
    path: '/docs/api-reference',
    color: 'text-purple-400',
  },
  {
    title: 'JavaScript SDK',
    description: 'Official @epitomefyi/sdk client for TS/JS apps',
    icon: Package,
    path: '/docs/javascript-sdk',
    color: 'text-sky-400',
  },
  {
    title: 'AI SDK Tools',
    description: 'AI SDK tool bindings for searchMemory and saveMemory',
    icon: Bot,
    path: '/docs/javascript-sdk-ai-tools',
    color: 'text-violet-400',
  },
  {
    title: 'Memory Router',
    description: 'Proxy OpenAI/Anthropic calls with automatic memory',
    icon: Route,
    path: '/docs/memory-router',
    color: 'text-indigo-400',
  },
  {
    title: 'Self-Hosting',
    description: 'Deploy your own Epitome instance',
    icon: Server,
    path: '/docs/self-hosting',
    color: 'text-orange-400',
  },
  {
    title: 'Architecture',
    description: 'System design and key decisions',
    icon: Layers,
    path: '/docs/architecture',
    color: 'text-cyan-400',
  },
  {
    title: 'Data Model',
    description: 'Database schema and JSONB contracts',
    icon: Database,
    path: '/docs/data-model',
    color: 'text-yellow-400',
  },
  {
    title: 'Security',
    description: 'Auth, isolation, and consent model',
    icon: Shield,
    path: '/docs/security',
    color: 'text-red-400',
  },
  {
    title: 'Billing & Agents',
    description: 'Plans, pricing, and x402 agent payments',
    icon: CreditCard,
    path: '/docs/billing',
    color: 'text-amber-400',
  },
  {
    title: 'Contributing',
    description: 'Development setup and PR process',
    icon: GitPullRequest,
    path: '/docs/contributing',
    color: 'text-emerald-400',
  },
  {
    title: 'Troubleshooting',
    description: 'Common issues and FAQ',
    icon: HelpCircle,
    path: '/docs/troubleshooting',
    color: 'text-pink-400',
  },
];

export default function DocsIndex() {
  return (
    <DocPage
      title="Epitome Documentation"
      description="Everything you need to build with Epitome — from quick start to API reference."
    >
      <p className="text-muted-foreground mb-8">
        Epitome is a personal AI database that gives every AI agent a shared, persistent memory
        of you. It combines a structured database, portable identity profile, knowledge graph,
        and consent system into a single open-source platform. Choose a section below to get started.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.path} to={section.path} className="no-underline">
              <Card className="h-full transition-colors hover:border-foreground/20 hover:bg-muted/50 cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Icon className={`size-5 ${section.color}`} />
                    <CardTitle className="text-base">{section.title}</CardTitle>
                  </div>
                  <CardDescription className="line-clamp-2">{section.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </DocPage>
  );
}
