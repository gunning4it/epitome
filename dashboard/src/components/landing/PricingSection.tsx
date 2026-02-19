import { motion } from 'framer-motion';
import { Check, Zap, Coins } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Feature {
  text: string;
}

interface Tier {
  name: string;
  description: string;
  price: React.ReactNode;
  features: Feature[];
  cta: { label: string; to: string; variant: 'default' | 'outline' };
  highlight?: boolean;
  iconAccent?: string;
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    description: 'For individuals getting started',
    price: (
      <p className="text-3xl font-display tracking-tight">
        $0
      </p>
    ),
    features: [
      { text: '2 tables' },
      { text: '3 agents' },
      { text: '100 graph entities' },
      { text: '30-day audit retention' },
      { text: 'MCP + REST API access' },
    ],
    cta: { label: 'Get Started', to: '/onboarding', variant: 'outline' },
  },
  {
    name: 'Pro',
    description: 'For power users',
    price: (
      <p className="text-3xl font-display tracking-tight">
        $5<span className="text-base font-normal text-muted-foreground">/mo</span>
      </p>
    ),
    features: [
      { text: 'Unlimited tables' },
      { text: 'Unlimited agents' },
      { text: 'Unlimited graph entities' },
      { text: '365-day audit retention' },
      { text: 'Priority support' },
    ],
    cta: { label: 'Get Started', to: '/onboarding', variant: 'default' },
    highlight: true,
  },
  {
    name: 'Agent Pay-Per-Call',
    description: 'For AI agents via x402',
    price: (
      <p className="text-3xl font-display tracking-tight">
        $0.01<span className="text-base font-normal text-muted-foreground">/call</span>
      </p>
    ),
    features: [
      { text: '$0.01 per MCP tool call' },
      { text: 'Pay with USDC on Base' },
      { text: 'No subscription needed' },
      { text: 'Automatic pro-tier access per call' },
      { text: 'x402 protocol (HTTP 402)' },
    ],
    cta: { label: 'Read the Docs', to: '/docs/billing', variant: 'outline' },
    iconAccent: 'text-blue-400',
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

export default function PricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32 relative">
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
            Pricing
          </motion.p>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight mb-4"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Simple, transparent pricing.
          </motion.h2>
          <motion.p
            className="text-lg text-muted-foreground max-w-xl mx-auto"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Start free, upgrade when you need more.
          </motion.p>
        </div>

        {/* Pricing cards */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {TIERS.map((tier) => {
            const cardContent = (
              <Card
                className={cn(
                  'group h-full border-border/50 hover:border-border transition-colors flex flex-col',
                  tier.highlight ? 'border-primary card-glow' : 'card-glow'
                )}
              >
                <CardContent className="pt-6 flex flex-col flex-1">
                  {/* Header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      {tier.highlight && (
                        <Zap className="size-4 text-primary" />
                      )}
                      {tier.iconAccent && (
                        <Coins className={cn('size-4', tier.iconAccent)} />
                      )}
                      <h3 className="text-base font-semibold tracking-tight">
                        {tier.name}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {tier.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="mb-6">
                    {tier.price}
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-8 flex-1">
                    {tier.features.map((feature) => (
                      <li
                        key={feature.text}
                        className="flex items-center gap-3 text-sm text-muted-foreground"
                      >
                        <Check className="size-4 text-primary shrink-0" />
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Button
                    asChild
                    variant={tier.cta.variant}
                    className="w-full"
                  >
                    <Link to={tier.cta.to}>{tier.cta.label}</Link>
                  </Button>
                </CardContent>
              </Card>
            );

            return (
              <motion.div key={tier.name} variants={cardVariants}>
                {tier.highlight ? (
                  <div className="rounded-xl bg-gradient-to-b from-primary/50 to-primary/20 p-px h-full">
                    {cardContent}
                  </div>
                ) : (
                  cardContent
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
