import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const ENTITY_COLORS: Record<string, string> = {
  person: '#3b82f6',
  place: '#10b981',
  organization: '#8b5cf6',
  concept: '#06b6d4',
  creative_work: '#ec4899',
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
  { id: 'You', type: 'person', radius: 7 },
  { id: 'Agent', type: 'organization', radius: 6 },
  { id: 'Memory', type: 'concept', radius: 7 },
  { id: 'Profile', type: 'person', radius: 5 },
  { id: 'Graph', type: 'concept', radius: 6 },
  { id: 'Entity', type: 'creative_work', radius: 5 },
  { id: 'Skill', type: 'skill', radius: 5 },
  { id: 'Place', type: 'place', radius: 5 },
  { id: 'Preference', type: 'concept', radius: 4 },
  { id: 'Context', type: 'organization', radius: 5 },
  { id: 'Recall', type: 'skill', radius: 4 },
  { id: 'Trust', type: 'creative_work', radius: 4 },
];

const EDGES: GraphEdge[] = [
  { source: 'You', target: 'Memory' },
  { source: 'You', target: 'Profile' },
  { source: 'Agent', target: 'Memory' },
  { source: 'Memory', target: 'Graph' },
  { source: 'Graph', target: 'Entity' },
  { source: 'Profile', target: 'Skill' },
  { source: 'Profile', target: 'Place' },
  { source: 'Memory', target: 'Preference' },
  { source: 'Agent', target: 'Context' },
  { source: 'Context', target: 'Recall' },
  { source: 'Memory', target: 'Trust' },
];

export default function MiniGraph() {
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
      const filter = defs.append('filter').attr('id', 'mini-glow');
      filter
        .append('feGaussianBlur')
        .attr('stdDeviation', '3')
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
            .distance(60)
        )
        .force('charge', d3.forceManyBody().strength(-40))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide<GraphNode>().radius((d) => d.radius + 3))
        .alphaDecay(0.005);

      const linkGroup = svgEl.append('g');
      const nodeGroup = svgEl.append('g');

      const links = linkGroup
        .selectAll('line')
        .data(edgesData)
        .enter()
        .append('line')
        .attr('stroke', '#ffffff')
        .attr('stroke-opacity', 0.1)
        .attr('stroke-width', 0.5);

      const nodes = nodeGroup
        .selectAll('circle')
        .data(nodesData)
        .enter()
        .append('circle')
        .attr('r', (d) => d.radius)
        .attr('fill', (d) => ENTITY_COLORS[d.type] || '#71717a')
        .attr('filter', 'url(#mini-glow)')
        .attr('opacity', 0.5)
        .each(function () {
          const el = d3.select(this);
          el.append('animate')
            .attr('attributeName', 'opacity')
            .attr('values', '0.3;0.65;0.3')
            .attr('dur', `${4 + Math.random() * 4}s`)
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

  // SSR-safe
  if (typeof window === 'undefined') {
    return <div className="absolute inset-0 overflow-hidden pointer-events-none" />;
  }

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg ref={svgRef} className="w-full h-full opacity-20" />
    </div>
  );
}
