import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const ENTITY_COLORS: Record<string, string> = {
  person: '#3b82f6',
  place: '#10b981',
  organization: '#8b5cf6',
  event: '#f59e0b',
  concept: '#06b6d4',
  creative_work: '#ec4899',
  product: '#f97316',
  food: '#84cc16',
  health: '#ef4444',
  hobby: '#14b8a6',
  skill: '#6366f1',
};

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: string;
  radius: number;
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

const NODES: GraphNode[] = [
  { id: 'Sarah', type: 'person', radius: 7 },
  { id: 'Alex', type: 'person', radius: 6 },
  { id: 'Mom', type: 'person', radius: 5 },
  { id: 'New York', type: 'place', radius: 7 },
  { id: 'Tokyo', type: 'place', radius: 6 },
  { id: 'Paris', type: 'place', radius: 5 },
  { id: 'Acme Corp', type: 'organization', radius: 7 },
  { id: 'MIT', type: 'organization', radius: 5 },
  { id: 'Birthday Party', type: 'event', radius: 6 },
  { id: 'Conference', type: 'event', radius: 5 },
  { id: 'Machine Learning', type: 'concept', radius: 7 },
  { id: 'Philosophy', type: 'concept', radius: 5 },
  { id: 'The Matrix', type: 'creative_work', radius: 6 },
  { id: 'Dune', type: 'creative_work', radius: 5 },
  { id: 'iPhone', type: 'product', radius: 5 },
  { id: 'Tesla', type: 'product', radius: 6 },
  { id: 'Sushi', type: 'food', radius: 6 },
  { id: 'Coffee', type: 'food', radius: 4 },
  { id: 'Running', type: 'hobby', radius: 5 },
  { id: 'Photography', type: 'hobby', radius: 6 },
  { id: 'Python', type: 'skill', radius: 7 },
  { id: 'Piano', type: 'skill', radius: 5 },
  { id: 'Yoga', type: 'health', radius: 5 },
  { id: 'Meditation', type: 'health', radius: 4 },
  { id: 'Startup', type: 'organization', radius: 5 },
];

const EDGES: GraphEdge[] = [
  { source: 'Sarah', target: 'New York' },
  { source: 'Sarah', target: 'Birthday Party' },
  { source: 'Alex', target: 'Acme Corp' },
  { source: 'Alex', target: 'Machine Learning' },
  { source: 'Mom', target: 'Paris' },
  { source: 'New York', target: 'Sushi' },
  { source: 'Tokyo', target: 'Sushi' },
  { source: 'Machine Learning', target: 'Python' },
  { source: 'Python', target: 'MIT' },
  { source: 'Running', target: 'Yoga' },
  { source: 'Photography', target: 'Tokyo' },
  { source: 'The Matrix', target: 'Philosophy' },
  { source: 'Conference', target: 'Acme Corp' },
  { source: 'Coffee', target: 'Meditation' },
  { source: 'Tesla', target: 'Startup' },
];

export default function HeroGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          renderGraph(width, height);
        }
      }
    });

    resizeObserver.observe(container);

    function renderGraph(width: number, height: number) {
      const svgEl = d3.select(svg);
      svgEl.selectAll('*').remove();
      svgEl.attr('width', width).attr('height', height);

      // SVG filter for glow
      const defs = svgEl.append('defs');
      const filter = defs.append('filter').attr('id', 'glow');
      filter
        .append('feGaussianBlur')
        .attr('stdDeviation', '4')
        .attr('result', 'coloredBlur');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'coloredBlur');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');

      const nodesData: GraphNode[] = NODES.map((n) => ({ ...n }));
      const edgesData: GraphEdge[] = EDGES.map((e) => ({ ...e }));

      const simulation = d3
        .forceSimulation<GraphNode>(nodesData)
        .force(
          'link',
          d3
            .forceLink<GraphNode, GraphEdge>(edgesData)
            .id((d) => d.id)
            .distance(80)
        )
        .force('charge', d3.forceManyBody().strength(-60))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide<GraphNode>().radius((d) => d.radius + 4))
        .alphaDecay(0.005);

      const linkGroup = svgEl.append('g');
      const nodeGroup = svgEl.append('g');

      const links = linkGroup
        .selectAll('line')
        .data(edgesData)
        .enter()
        .append('line')
        .attr('stroke', '#ffffff')
        .attr('stroke-opacity', 0.15)
        .attr('stroke-width', 0.5);

      // Add subtle pulse animation
      const pulse = defs.append('animate');
      pulse
        .attr('id', 'pulse')
        .attr('attributeName', 'opacity')
        .attr('values', '0.6;0.9;0.6')
        .attr('dur', '4s')
        .attr('repeatCount', 'indefinite');

      const nodes = nodeGroup
        .selectAll('circle')
        .data(nodesData)
        .enter()
        .append('circle')
        .attr('r', (d) => d.radius)
        .attr('fill', (d) => ENTITY_COLORS[d.type] || '#71717a')
        .attr('filter', 'url(#glow)')
        .attr('opacity', 0.7)
        .each(function () {
          const el = d3.select(this);
          el.append('animate')
            .attr('attributeName', 'opacity')
            .attr('values', '0.5;0.85;0.5')
            .attr('dur', `${3 + Math.random() * 3}s`)
            .attr('repeatCount', 'indefinite');
        });

      simulation.on('tick', () => {
        links
          .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
          .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
          .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
          .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

        nodes
          .attr('cx', (d) => d.x ?? 0)
          .attr('cy', (d) => d.y ?? 0);
      });

      return () => {
        simulation.stop();
      };
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // SSR-safe: D3 requires DOM, render empty container during server-side rendering
  if (typeof window === 'undefined') {
    return <div className="absolute inset-0 overflow-hidden pointer-events-none" />;
  }

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg ref={svgRef} className="w-full h-full opacity-30" />
    </div>
  );
}
