import { motion } from 'framer-motion';
import MiniGraph from './MiniGraph';

interface ComparisonHeroProps {
  superlabel: string;
  title: string;
  subtitle: string;
}

export default function ComparisonHero({ superlabel, title, subtitle }: ComparisonHeroProps) {
  return (
    <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden noise-overlay">
      {/* Radial gradient glows */}
      <div
        className="absolute top-[-30%] left-[-15%] w-[70%] h-[70%] rounded-full blur-[120px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.20) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute bottom-[-25%] right-[-10%] w-[55%] h-[55%] rounded-full blur-[100px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute top-[40%] right-[10%] w-[30%] h-[30%] rounded-full blur-[80px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.06) 0%, transparent 60%)',
        }}
      />

      {/* Grid overlay with edge fade */}
      <div className="absolute inset-0 bg-grid bg-grid-fade pointer-events-none" />

      {/* Ambient mini knowledge graph */}
      <MiniGraph />

      {/* Text content */}
      <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
        <motion.p
          className="text-sm font-mono tracking-[0.2em] uppercase text-primary/70 mb-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {superlabel}
        </motion.p>

        <motion.h1
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display tracking-tight leading-[0.95] mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          {title}
        </motion.h1>

        <motion.p
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6 }}
        >
          {subtitle}
        </motion.p>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
    </section>
  );
}
