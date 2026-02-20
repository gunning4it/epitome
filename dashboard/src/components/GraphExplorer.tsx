import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ENTITY_DISPLAY, type EntityType } from '@/lib/ontology';
import type { Entity, Edge } from '@/lib/types';

interface GraphExplorerProps {
  nodes: Entity[];
  edges: Edge[];
  onNodeClick?: (node: Entity) => void;
  searchQuery?: string;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  mention_count: number;
  confidence: number;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  relation: string;
  weight: number;
}

const ENTITY_COLORS: Record<string, string> = {
  ...(Object.fromEntries(
    (Object.entries(ENTITY_DISPLAY) as [EntityType, { label: string; color: string }][]).map(
      ([type, config]) => [type, config.color]
    )
  )),
  default: '#6b7280',
};

const RELATION_COLORS: Record<string, string> = {
  knows: '#3b82f6',
  located_at: '#10b981',
  works_at: '#8b5cf6',
  attended: '#f59e0b',
  related_to: '#6b7280',
  default: '#9ca3af',
};

export default function GraphExplorer({
  nodes,
  edges,
  onNodeClick,
  searchQuery,
}: GraphExplorerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!svgRef.current || !nodes.length) return;

    // Clear previous graph
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current);
    const width = dimensions.width;
    const height = dimensions.height;

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create main group
    const g = svg.append('g');

    // Convert to D3 format
    const d3Nodes: D3Node[] = nodes.map((node) => ({
      id: String(node.id),
      name: node.name,
      type: node.type,
      mention_count: node.mention_count,
      confidence: node.confidence,
    }));

    // Keep link endpoints aligned with the current node payload to avoid D3 "node not found" crashes.
    const nodeIds = new Set(d3Nodes.map((node) => node.id));
    const d3Links: D3Link[] = edges
      .map((edge) => ({
        source: String(edge.source_id),
        target: String(edge.target_id),
        relation: edge.relation,
        weight: edge.weight,
      }))
      .filter((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target)));

    // Create force simulation
    const simulation = d3
      .forceSimulation<D3Node>(d3Nodes)
      .force(
        'link',
        d3
          .forceLink<D3Node, D3Link>(d3Links)
          .id((d) => d.id)
          .distance(150)
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3.forceCollide<D3Node>().radius((d) => Math.sqrt(d.mention_count) * 5 + 20)
      );

    // Draw edges
    const link = g
      .append('g')
      .selectAll('line')
      .data(d3Links)
      .join('line')
      .attr('stroke', (d) => RELATION_COLORS[d.relation] || RELATION_COLORS.default)
      .attr('stroke-width', (d) => Math.sqrt(d.weight) * 2)
      .attr('stroke-opacity', 0.4);

    // Draw nodes
    const node = g
      .append('g')
      .selectAll('circle')
      .data(d3Nodes)
      .join('circle')
      .attr('r', (d) => Math.sqrt(d.mention_count) * 5 + 20)
      .attr('fill', (d) => ENTITY_COLORS[d.type] || ENTITY_COLORS.default)
      .attr('stroke', '#27272a')
      .attr('stroke-width', 2)
      .attr('opacity', (d) => {
        if (!searchQuery) return 1;
        return d.name.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0.3;
      })
      .style('cursor', 'pointer');

    // Add drag behavior
    const dragHandler = d3
      .drag<SVGCircleElement, D3Node>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event) => {
        if (!event.active) simulation.alphaTarget(0);
      });

    dragHandler(node as d3.Selection<SVGCircleElement, D3Node, SVGGElement, unknown>);

    // Add click handler — pin node in place to prevent drift
    node.on('click', (_event, d) => {
      d.fx = d.x;
      d.fy = d.y;
      if (onNodeClick) {
        const originalNode = nodes.find((n) => String(n.id) === d.id);
        if (originalNode) onNodeClick(originalNode);
      }
    });

    // Double-click to unpin node
    node.on('dblclick', (_event, d) => {
      d.fx = null;
      d.fy = null;
    });

    // Add labels
    const label = g
      .append('g')
      .selectAll('text')
      .data(d3Nodes)
      .join('text')
      .text((d) => d.name)
      .attr('fill', '#fafafa')
      .attr('font-family', 'Inter Variable, sans-serif')
      .attr('font-size', 11)
      .attr('dx', (d) => Math.sqrt(d.mention_count) * 5 + 25)
      .attr('dy', 4)
      .attr('opacity', 1)
      .style('pointer-events', 'none');

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as D3Node).x ?? 0)
        .attr('y1', (d) => (d.source as D3Node).y ?? 0)
        .attr('x2', (d) => (d.target as D3Node).x ?? 0)
        .attr('y2', (d) => (d.target as D3Node).y ?? 0);

      node.attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0);

      label.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, dimensions, searchQuery, onNodeClick]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          setDimensions({
            width: container.clientWidth,
            height: container.clientHeight,
          });
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <svg
      ref={svgRef}
      width={dimensions.width}
      height={dimensions.height}
      className="rounded-lg bg-card border border-border"
    />
  );
}
