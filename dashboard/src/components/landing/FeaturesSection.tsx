import { motion } from 'framer-motion';
import { Database, User, ShieldCheck, Network, Lock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Layer {
  icon: LucideIcon;
  number: string;
  name: string;
  description: string;
  accent: string;
}

const LAYERS: Layer[] = [
  {
    icon: Database,
    number: '01',
    name: 'Personal Database',
    accent: 'group-hover:text-blue-400',
    description:
      'Structured tables, vector semantic memory, and key-value storage. Your data lives in PostgreSQL \u2014 queryable, exportable, yours.',
  },
  {
    icon: User,
    number: '02',
    name: 'Portable Identity',
    accent: 'group-hover:text-violet-400',
    description:
      'A structured profile any AI agent reads instantly. Name, preferences, relationships \u2014 zero cold start, every conversation.',
  },
  {
    icon: ShieldCheck,
    number: '03',
    name: 'Memory Quality',
    accent: 'group-hover:text-emerald-400',
    description:
      'Confidence scoring, source attribution, and lifecycle management. Memories earn trust through reinforcement, not blind faith.',
  },
  {
    icon: Network,
    number: '04',
    name: 'Knowledge Graph',
    accent: 'group-hover:text-cyan-400',
    description:
      'Entities with typed, weighted edges. People, places, concepts \u2014 connected in a graph that grows with every interaction.',
  },
  {
    icon: Lock,
    number: '05',
    name: 'Consent & Audit',
    accent: 'group-hover:text-amber-400',
    description:
      'Per-table permissions and an append-only activity log. You control exactly what each agent can see and do.',
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 sm:py-32 relative">
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
            Architecture
          </motion.p>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight mb-4"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            The Five Layers
          </motion.h2>
          <motion.p
            className="text-lg text-muted-foreground max-w-xl mx-auto"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Each layer compounds on the last.
          </motion.p>
        </div>

        {/* Cards grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {LAYERS.map((layer) => {
            const Icon = layer.icon;
            return (
              <motion.div key={layer.name} variants={cardVariants}>
                <Card className={cn('group h-full card-glow border-border/50 hover:border-border transition-colors')}>
                  <CardContent className="pt-6">
                    {/* Layer number + icon row */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-mono text-muted-foreground/50 tracking-wider">
                        {layer.number}
                      </span>
                      <Icon className={cn('size-5 text-muted-foreground transition-colors duration-300', layer.accent)} />
                    </div>
                    <h3 className="text-base font-semibold mb-2 tracking-tight">{layer.name}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {layer.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
