import { motion } from 'framer-motion';
import LandingNav from '@/components/landing/LandingNav';
import Footer from '@/components/landing/Footer';
import SEO from '@/components/SEO';
import ComparisonJsonLd from '@/components/comparison/ComparisonJsonLd';
import ComparisonHero from '@/components/comparison/ComparisonHero';
import CompetitorCard from '@/components/comparison/CompetitorCard';
import ComparisonCta from '@/components/comparison/ComparisonCta';
import { COMPETITORS, COMPARISON_PAGES, HUB_SEO } from '@/data/comparisonData';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

export default function Comparison() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={HUB_SEO.title}
        description={HUB_SEO.description}
        path="/comparison"
      />
      <ComparisonJsonLd
        variant="hub"
        path="/comparison"
        title={HUB_SEO.title}
        description={HUB_SEO.description}
      />

      <LandingNav />

      <ComparisonHero
        superlabel="Compare Alternatives"
        title="How does Epitome stack up?"
        subtitle="Feature-by-feature comparison of memory architecture, knowledge graph, privacy, and pricing against the leading alternatives."
      />

      {/* Competitor cards grid */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            className="text-center mb-14"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3">
              Alternatives
            </p>
            <h2 className="text-3xl sm:text-4xl font-display tracking-tight mb-4">
              Pick your comparison
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Each comparison page breaks down features, architecture, and pricing across three platforms.
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
          >
            {COMPARISON_PAGES.map((page) => (
              <CompetitorCard
                key={page.slug}
                competitor={COMPETITORS[page.primary]}
                secondary={COMPETITORS[page.secondary]}
                slug={page.slug}
              />
            ))}
          </motion.div>
        </div>
      </section>

      {/* Why Epitome section */}
      <section className="py-20 sm:py-28 relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3">
              Why Epitome
            </p>
            <h2 className="text-3xl sm:text-4xl font-display tracking-tight mb-6">
              The only <span className="text-gradient">open-source</span> AI memory vault
            </h2>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-left"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div>
              <h3 className="text-sm font-semibold mb-2">Own your data</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Self-host on your own PostgreSQL. Full SQL dump export. No vendor lock-in, ever.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Structured memory</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Knowledge graph with confidence scoring, contradiction detection, and memory lifecycle management.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Agent-native</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                9 MCP tools over Streamable HTTP. Any compatible agent discovers and uses your memory automatically.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <ComparisonCta />
      <Footer />
    </div>
  );
}
