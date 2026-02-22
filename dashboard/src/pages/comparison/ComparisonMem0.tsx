import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import LandingNav from '@/components/landing/LandingNav';
import Footer from '@/components/landing/Footer';
import SEO from '@/components/SEO';
import ComparisonJsonLd from '@/components/comparison/ComparisonJsonLd';
import ComparisonHero from '@/components/comparison/ComparisonHero';
import ComparisonMatrix from '@/components/comparison/ComparisonMatrix';
import ComparisonCta from '@/components/comparison/ComparisonCta';
import {
  COMPARISON_PAGES,
  COMPETITORS,
  FEATURE_CATEGORIES,
  KEY_DIFFERENCES,
} from '@/data/comparisonData';

const PAGE = COMPARISON_PAGES.find((p) => p.slug === 'mem0')!;

export default function ComparisonMem0() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={PAGE.seo.title}
        description={PAGE.seo.description}
        path="/comparison/mem0"
      />
      <ComparisonJsonLd
        variant="individual"
        path="/comparison/mem0"
        title={PAGE.seo.title}
        description={PAGE.seo.description}
        competitors={[COMPETITORS.mem0.name, COMPETITORS.supermemory.name]}
      />

      <LandingNav />

      <ComparisonHero
        superlabel={PAGE.superlabel}
        title={PAGE.title}
        subtitle={PAGE.subtitle}
      />

      <ComparisonMatrix
        columns={['epitome', 'mem0', 'supermemory']}
        categories={FEATURE_CATEGORIES}
      />

      {/* Key Differences */}
      <section className="py-20 sm:py-28 relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="mx-auto max-w-4xl px-6">
          <motion.div
            className="text-center mb-14"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3">
              Deep Dive
            </p>
            <h2 className="text-3xl sm:text-4xl font-display tracking-tight">
              Key differences
            </h2>
          </motion.div>

          <div className="space-y-12">
            {KEY_DIFFERENCES.mem0.map((diff, i) => (
              <motion.div
                key={diff.heading}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <h3 className="text-lg font-semibold tracking-tight mb-3">{diff.heading}</h3>
                <p className="text-muted-foreground leading-relaxed">{diff.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Cross-links */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-6">
          <p className="text-sm font-mono tracking-[0.15em] uppercase text-muted-foreground mb-6 text-center">
            More Comparisons
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/comparison/supermemory"
              className="group inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Epitome vs Supermemory
              <ArrowRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <span className="hidden sm:inline text-border">|</span>
            <Link
              to="/comparison/vertexrag"
              className="group inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Epitome vs Vertex AI RAG
              <ArrowRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      <ComparisonCta />
      <Footer />
    </div>
  );
}
