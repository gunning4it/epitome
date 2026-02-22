import { Fragment } from 'react';
import { Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CellValue, CompetitorId, FeatureCategory } from '@/data/comparisonData';
import { COMPETITORS } from '@/data/comparisonData';
import ComparisonCategoryHeader from './ComparisonCategoryHeader';

interface ComparisonMatrixProps {
  columns: CompetitorId[];
  categories: FeatureCategory[];
}

function CellContent({ value }: { value: CellValue }) {
  switch (value.type) {
    case 'check':
      return <Check className="size-4 text-primary mx-auto" />;
    case 'cross':
      return <X className="size-4 text-muted-foreground/40 mx-auto" />;
    case 'text':
      return <span className="text-sm text-foreground/80">{value.value}</span>;
    case 'limited':
      return (
        <Badge variant="outline" className="text-xs text-amber-400/80 border-amber-400/30">
          {value.value ?? 'Limited'}
        </Badge>
      );
  }
}

export default function ComparisonMatrix({ columns, categories }: ComparisonMatrixProps) {
  return (
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
            Feature Comparison
          </p>
          <h2 className="text-3xl sm:text-4xl font-display tracking-tight">
            Side by side
          </h2>
        </motion.div>

        {/* Desktop: full table */}
        <motion.div
          className="hidden md:block"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          <div className="rounded-xl border border-border/50 overflow-hidden bg-card/30 backdrop-blur-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground w-[220px]">
                    Feature
                  </th>
                  {columns.map((col, i) => (
                    <th
                      key={col}
                      className={cn(
                        'py-4 px-4 text-center text-sm font-semibold',
                        i === 0 && 'bg-primary/[0.05] border-x border-primary/30 text-foreground',
                        i !== 0 && 'text-muted-foreground'
                      )}
                    >
                      {COMPETITORS[col].name}
                      {i === 0 && (
                        <span className="block text-[10px] font-mono font-normal text-primary/60 mt-0.5">
                          recommended
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((category, catIdx) => (
                  <Fragment key={category.name}>
                    {/* Category header row */}
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        className={catIdx === 0 ? 'px-4 pt-2' : 'px-4 pt-6'}
                      >
                        <ComparisonCategoryHeader
                          name={category.name}
                          icon={category.icon}
                          compact
                        />
                      </td>
                    </tr>
                    {/* Feature rows */}
                    {category.features.map((feature) => (
                      <tr key={feature.name} className="border-b border-border/30 last:border-b-0">
                        <td className="py-3 pr-4 pl-4 text-sm text-muted-foreground">
                          {feature.name}
                        </td>
                        {columns.map((col, i) => (
                          <td
                            key={col}
                            className={cn(
                              'py-3 px-4 text-center',
                              i === 0 && 'bg-primary/[0.03] border-x border-primary/10'
                            )}
                          >
                            <CellContent value={feature.values[col]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Mobile: stacked cards per category */}
        <div className="md:hidden space-y-8">
          {categories.map((category) => (
            <motion.div
              key={category.name}
              className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-4"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5 }}
            >
              <ComparisonCategoryHeader name={category.name} icon={category.icon} />
              <div className="space-y-4 mt-3">
                {category.features.map((feature) => (
                  <div key={feature.name} className="space-y-2">
                    <p className="text-sm font-medium text-foreground/90">{feature.name}</p>
                    {columns.map((col, i) => (
                      <div
                        key={col}
                        className={cn(
                          'flex items-center justify-between py-1.5 px-3 rounded-md text-sm',
                          i === 0 && 'bg-primary/[0.05] border border-primary/20'
                        )}
                      >
                        <span className={cn(
                          'text-xs',
                          i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                        )}>
                          {COMPETITORS[col].name}
                        </span>
                        <CellContent value={feature.values[col]} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
