import { motion } from 'framer-motion';
import { Plug, Brain, Share2 } from 'lucide-react';
import { CodeBlock } from '@/components/CodeBlock';

const MCP_CONFIG = `{
  "mcpServers": {
    "epitome": {
      "url": "https://your-instance.epitome.fyi/mcp"
    }
  }
}`;

function EntityDemo() {
  return (
    <div className="rounded-lg bg-card border border-border p-4 text-sm leading-relaxed">
      <span className="text-muted-foreground">&ldquo;I had </span>
      <span className="inline-block rounded bg-[#84cc16]/10 text-[#84cc16] px-1.5 py-0.5 font-medium text-xs border border-[#84cc16]/20">
        sushi
      </span>
      <span className="text-muted-foreground"> with </span>
      <span className="inline-block rounded bg-[#3b82f6]/10 text-[#3b82f6] px-1.5 py-0.5 font-medium text-xs border border-[#3b82f6]/20">
        Sarah
      </span>
      <span className="text-muted-foreground"> in </span>
      <span className="inline-block rounded bg-[#10b981]/10 text-[#10b981] px-1.5 py-0.5 font-medium text-xs border border-[#10b981]/20">
        New York
      </span>
      <span className="text-muted-foreground">&rdquo;</span>
    </div>
  );
}

function SharedMemorySvg() {
  const agents = [
    { label: 'Claude', x: 40, y: 30, color: '#f97316' },
    { label: 'ChatGPT', x: 40, y: 80, color: '#10b981' },
    { label: 'Gemini', x: 40, y: 130, color: '#3b82f6' },
  ];
  const center = { x: 200, y: 80 };

  return (
    <div className="rounded-lg bg-card border border-border p-4">
      <svg viewBox="0 0 260 160" className="w-full h-auto" aria-hidden="true">
        {/* Connection lines */}
        {agents.map((agent) => (
          <line
            key={agent.label}
            x1={agent.x + 24}
            y1={agent.y}
            x2={center.x - 26}
            y2={center.y}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}
        {/* Agent nodes */}
        {agents.map((agent) => (
          <g key={agent.label}>
            <circle
              cx={agent.x}
              cy={agent.y}
              r="6"
              fill={agent.color}
              opacity="0.2"
            />
            <circle
              cx={agent.x}
              cy={agent.y}
              r="3"
              fill={agent.color}
            />
            <text
              x={agent.x + 12}
              y={agent.y + 3.5}
              fill="rgba(255,255,255,0.5)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {agent.label}
            </text>
          </g>
        ))}
        {/* Center node */}
        <circle
          cx={center.x}
          cy={center.y}
          r="24"
          fill="rgba(139, 92, 246, 0.1)"
          stroke="rgba(139, 92, 246, 0.3)"
          strokeWidth="1"
        />
        <circle
          cx={center.x}
          cy={center.y}
          r="4"
          fill="#8b5cf6"
        />
        <text
          x={center.x}
          y={center.y + 38}
          fill="rgba(255,255,255,0.6)"
          fontSize="9"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          Epitome
        </text>
      </svg>
    </div>
  );
}

const STEPS = [
  {
    number: '01',
    icon: Plug,
    title: 'Connect your agent',
    description:
      'Add Epitome to Claude, ChatGPT, or any MCP-compatible client in seconds.',
    visual: <CodeBlock code={MCP_CONFIG} language="json" />,
  },
  {
    number: '02',
    icon: Brain,
    title: 'It learns about you',
    description:
      'Entities, preferences, and patterns are extracted automatically from every conversation.',
    visual: <EntityDemo />,
  },
  {
    number: '03',
    icon: Share2,
    title: 'Every agent shares memory',
    description:
      'Switch between AI platforms with zero cold start. Your context follows you everywhere.',
    visual: <SharedMemorySvg />,
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const stepVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 sm:py-32 relative">
      {/* Subtle separator glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40%] h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <motion.p
            className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            Getting Started
          </motion.p>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            How It Works
          </motion.h2>
        </div>

        {/* Steps */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-8"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.number}
                variants={stepVariants}
                className="relative"
              >
                {/* Step number + icon */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-mono text-muted-foreground/50 tracking-wider">
                    {step.number}
                  </span>
                  <Icon className="size-5 text-primary" />
                  <div className="flex-1 h-px bg-border/50" />
                </div>

                <h3 className="text-lg font-semibold mb-2 tracking-tight">{step.title}</h3>

                <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                  {step.description}
                </p>

                {/* Visual element */}
                <div>{step.visual}</div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
