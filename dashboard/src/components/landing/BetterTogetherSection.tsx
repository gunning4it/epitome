import { motion } from 'framer-motion';
import { Cpu, Brain, ArrowRight, ExternalLink } from 'lucide-react';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

export default function BetterTogetherSection() {
  return (
    <section className="py-24 sm:py-32 relative">
      {/* Separator */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40%] h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="mx-auto max-w-5xl px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <motion.p
            className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            The Local AI Stack
          </motion.p>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Better Together
          </motion.h2>
        </div>

        {/* Two cards with connector */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-4 items-center"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
        >
          {/* OpenClaw card */}
          <motion.div variants={itemVariants}>
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-border bg-card p-6 hover:border-orange-500/30 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Cpu className="size-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                    OpenClaw
                    <ExternalLink className="size-3.5 opacity-40 group-hover:opacity-70 transition-opacity" />
                  </h3>
                  <p className="text-xs font-mono text-muted-foreground">Compute & Orchestration</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Deploy AI agents locally on your hardware. Task execution, home automation,
                messaging — all running on your own machines.
              </p>
            </a>
          </motion.div>

          {/* Connector */}
          <motion.div
            variants={itemVariants}
            className="hidden md:flex flex-col items-center gap-2 py-4"
          >
            <ArrowRight className="size-4 text-muted-foreground/40 rotate-180" />
            <div className="w-px h-8 bg-gradient-to-b from-orange-500/20 via-border to-purple-500/20" />
            <ArrowRight className="size-4 text-muted-foreground/40" />
          </motion.div>

          {/* Epitome card */}
          <motion.div variants={itemVariants}>
            <div className="rounded-xl border border-border bg-card p-6 border-primary/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Brain className="size-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Epitome</h3>
                  <p className="text-xs font-mono text-muted-foreground">Identity & Memory</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Persistent context, knowledge graph, portable profile. Every agent
                shares memory — no more starting from scratch.
              </p>
            </div>
          </motion.div>
        </motion.div>

        {/* Connector text */}
        <motion.p
          className="text-center text-sm text-muted-foreground mt-8 max-w-lg mx-auto"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          OpenClaw handles what your agents <em className="text-foreground not-italic font-medium">do</em>.
          Epitome handles what they <em className="text-foreground not-italic font-medium">know</em>.
        </motion.p>
      </div>
    </section>
  );
}
