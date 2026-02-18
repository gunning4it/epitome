import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Github, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/CodeBlock';

const CLONE_SNIPPET = `git clone https://github.com/gunning4it/epitome.git
cd epitome
docker compose up -d`;

export default function OpenSourceSection() {
  return (
    <section className="relative py-24 sm:py-32 overflow-hidden noise-overlay">
      {/* Background glows */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] rounded-full blur-[100px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute top-[20%] left-[20%] w-[30%] h-[30%] rounded-full blur-[80px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 60%)',
        }}
      />

      {/* Top separator */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40%] h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <motion.p
          className="text-sm font-mono tracking-[0.15em] uppercase text-primary/70 mb-3"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          Open Source
        </motion.p>
        <motion.h2
          className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight mb-10"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Self-Hostable. Yours.
        </motion.h2>

        {/* Code block */}
        <motion.div
          className="mb-8 text-left"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <CodeBlock code={CLONE_SNIPPET} language="bash" />
        </motion.div>

        {/* Badges */}
        <motion.div
          className="flex items-center justify-center gap-3 mb-10"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.35 }}
        >
          <Badge variant="outline" className="font-mono text-xs">MIT License</Badge>
          <Badge variant="outline" className="font-mono text-xs">
            <Github className="size-3 mr-1" />
            GitHub
          </Badge>
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.45 }}
        >
          <Button asChild variant="outline" size="lg" className="px-8">
            <a
              href="https://github.com/gunning4it/epitome"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 size-4" />
              Star on GitHub
              <ExternalLink className="ml-2 size-3 opacity-50" />
            </a>
          </Button>
          <Button asChild size="lg" className="btn-glow px-8">
            <Link to="/docs">Read the Docs</Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
