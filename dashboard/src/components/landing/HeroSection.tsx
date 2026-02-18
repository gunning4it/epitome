import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import HeroGraph from '@/components/landing/HeroGraph';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden noise-overlay">
      {/* Radial gradient glows — larger, more vivid */}
      <div
        className="absolute top-[-30%] left-[-15%] w-[70%] h-[70%] rounded-full blur-[120px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute bottom-[-25%] right-[-10%] w-[55%] h-[55%] rounded-full blur-[100px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 60%)',
        }}
      />
      {/* Third subtle glow — cyan accent for depth */}
      <div
        className="absolute top-[40%] right-[10%] w-[30%] h-[30%] rounded-full blur-[80px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.08) 0%, transparent 60%)',
        }}
      />

      {/* Grid overlay with edge fade */}
      <div className="absolute inset-0 bg-grid bg-grid-fade pointer-events-none" />

      {/* D3 graph background */}
      <HeroGraph />

      {/* Text content */}
      <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
        {/* Staggered entrance choreography */}
        <motion.p
          className="text-sm font-mono tracking-[0.2em] uppercase text-muted-foreground mb-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Personal AI Database
        </motion.p>

        <motion.h1
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-display tracking-tight leading-[0.95] mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          Your AI{' '}
          <br className="sm:hidden" />
          <span className="text-gradient">memory vault.</span>
        </motion.h1>

        <motion.p
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6 }}
        >
          The portable identity layer that gives every AI agent a shared,
          persistent memory of you. Open source. Self-hostable. Yours.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.85 }}
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

      {/* Bottom fade to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
    </section>
  );
}
