import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CompetitorInfo } from '@/data/comparisonData';

interface CompetitorCardProps {
  competitor: CompetitorInfo;
  slug: string;
}

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
};

export default function CompetitorCard({ competitor, slug }: CompetitorCardProps) {
  return (
    <motion.div variants={cardVariants}>
      <Card className="group h-full card-glow border-border/50 hover:border-border transition-colors">
        <CardContent className="pt-6 flex flex-col h-full">
          <h3 className="text-lg font-semibold tracking-tight mb-1">
            Epitome vs {competitor.name}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {competitor.tagline}
          </p>

          <ul className="space-y-2 mb-6 flex-1">
            {competitor.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-1 rounded-full bg-primary/50 shrink-0" />
                {bullet}
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" size="sm" className="w-full group-hover:border-primary/50 transition-colors">
            <Link to={`/comparison/${slug}`}>
              Compare
              <ArrowRight className="ml-2 size-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
