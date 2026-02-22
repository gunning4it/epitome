import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ComparisonCta() {
  return (
    <section className="relative py-24 sm:py-32">
      {/* Gradient separator */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Radial glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full blur-[120px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.10) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <motion.h2
          className="text-3xl sm:text-4xl font-display tracking-tight mb-4"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          Ready to own your AI memory?
        </motion.h2>

        <motion.p
          className="text-lg text-muted-foreground mb-8"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Start building with Epitome in under 2 minutes. Free forever for self-hosted.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Button asChild size="lg" className="btn-glow px-8">
            <Link to="/onboarding">
              Get Started
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="px-8">
            <Link to="/docs">View Docs</Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
