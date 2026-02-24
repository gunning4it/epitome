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
  id: string;
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

const MAX_BUBBLE_RADIUS = 60;

function nodeRadius(d: D3Node): number {
  return Math.min(Math.sqrt(d.mention_count) * 5 + 20, MAX_BUBBLE_RADIUS);
}

export default function GraphExplorer({
  nodes,
  edges,
  onNodeClick,
  searchQuery,
}: GraphExplorerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Persistent refs across renders
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const labelGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const initializedRef = useRef(false);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  // ── Init effect: runs once to create SVG structure, zoom, simulation ──
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => {
        gRef.current?.attr('transform', event.transform);
        zoomTransformRef.current = event.transform;
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Create persistent SVG groups
    const g = svg.append('g');
    gRef.current = g;
    linkGroupRef.current = g.append('g').attr('class', 'links');
    nodeGroupRef.current = g.append('g').attr('class', 'nodes');
    labelGroupRef.current = g.append('g').attr('class', 'labels');

    // Create simulation (empty initially)
    const simulation = d3
      .forceSimulation<D3Node>([])
      .force('charge', d3.forceManyBody().strength(-400))
      .force('collision', d3.forceCollide<D3Node>().radius((d) => nodeRadius(d)))
      .alphaDecay(0.02)
      .on('tick', tick);

    simulationRef.current = simulation;
    initializedRef.current = true;

    function tick() {
      linkGroupRef.current
        ?.selectAll<SVGLineElement, D3Link>('line')
        .attr('x1', (d) => (d.source as D3Node).x ?? 0)
        .attr('y1', (d) => (d.source as D3Node).y ?? 0)
        .attr('x2', (d) => (d.target as D3Node).x ?? 0)
        .attr('y2', (d) => (d.target as D3Node).y ?? 0);

      nodeGroupRef.current
        ?.selectAll<SVGCircleElement, D3Node>('circle')
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0);

      labelGroupRef.current
        ?.selectAll<SVGTextElement, D3Node>('text')
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => d.y ?? 0);
    }

    return () => {
      simulation.stop();
      simulationRef.current = null;
      initializedRef.current = false;
    };
  }, []); // Init only once

  // ── Data update effect: incremental D3 join on data changes ──
  useEffect(() => {
    if (!initializedRef.current || !simulationRef.current || !svgRef.current) return;

    const simulation = simulationRef.current;
    const width = dimensions.width;
    const height = dimensions.height;

    // Update center force with current dimensions
    simulation.force('center', d3.forceCenter(width / 2, height / 2));

    // Build D3 data, preserving positions from running simulation nodes
    const existingNodeMap = new Map<string, D3Node>();
    for (const n of simulation.nodes()) {
      existingNodeMap.set(n.id, n);
    }

    const d3Nodes: D3Node[] = nodes.map((node) => {
      const id = String(node.id);
      const existing = existingNodeMap.get(id);
      if (existing) {
        // Update mutable fields but keep position
        existing.name = node.name;
        existing.type = node.type;
        existing.mention_count = node.mention_count;
        existing.confidence = node.confidence;
        return existing;
      }
      return {
        id,
        name: node.name,
        type: node.type,
        mention_count: node.mention_count,
        confidence: node.confidence,
      };
    });

    const nodeIds = new Set(d3Nodes.map((n) => n.id));
    const d3Links: D3Link[] = edges
      .map((edge) => ({
        id: `${edge.source_id}-${edge.target_id}-${edge.relation}`,
        source: String(edge.source_id),
        target: String(edge.target_id),
        relation: edge.relation,
        weight: edge.weight,
      }))
      .filter((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target)));

    // ── Links: enter / update / exit ──
    linkGroupRef.current!
      .selectAll<SVGLineElement, D3Link>('line')
      .data(d3Links, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('line')
            .attr('stroke', (d) => RELATION_COLORS[d.relation] || RELATION_COLORS.default)
            .attr('stroke-width', (d) => Math.sqrt(d.weight) * 2)
            .attr('stroke-opacity', 0)
            .call((sel) => sel.transition().duration(300).attr('stroke-opacity', 0.4)),
        (update) =>
          update
            .attr('stroke', (d) => RELATION_COLORS[d.relation] || RELATION_COLORS.default)
            .attr('stroke-width', (d) => Math.sqrt(d.weight) * 2),
        (exit) =>
          exit.transition().duration(300).attr('stroke-opacity', 0).remove()
      );

    // ── Nodes: enter / update / exit ──
    const nodeSelection = nodeGroupRef.current!
      .selectAll<SVGCircleElement, D3Node>('circle')
      .data(d3Nodes, (d) => d.id)
      .join(
        (enter) => {
          const circles = enter
            .append('circle')
            .attr('r', 0)
            .attr('fill', (d) => ENTITY_COLORS[d.type] || ENTITY_COLORS.default)
            .attr('stroke', '#27272a')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer')
            .attr('cx', (d) => d.x ?? width / 2)
            .attr('cy', (d) => d.y ?? height / 2);

          circles
            .transition()
            .duration(400)
            .attr('r', (d) => nodeRadius(d));

          return circles;
        },
        (update) =>
          update
            .attr('fill', (d) => ENTITY_COLORS[d.type] || ENTITY_COLORS.default)
            .call((sel) =>
              sel.transition().duration(300).attr('r', (d) => nodeRadius(d))
            ),
        (exit) =>
          exit.transition().duration(300).attr('r', 0).attr('opacity', 0).remove()
      );

    // Search opacity
    nodeSelection.attr('opacity', (d) => {
      if (!searchQuery) return 1;
      return d.name.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0.3;
    });

    // Drag behavior
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

    dragHandler(nodeSelection);

    // Click to pin + select
    nodeSelection.on('click', (_event, d) => {
      d.fx = d.x;
      d.fy = d.y;
      if (onNodeClickRef.current) {
        const originalNode = nodes.find((n) => String(n.id) === d.id);
        if (originalNode) onNodeClickRef.current(originalNode);
      }
    });

    // Double-click to unpin
    nodeSelection.on('dblclick', (_event, d) => {
      d.fx = null;
      d.fy = null;
    });

    // ── Labels: enter / update / exit ──
    labelGroupRef.current!
      .selectAll<SVGTextElement, D3Node>('text')
      .data(d3Nodes, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('text')
            .text((d) => d.name)
            .attr('fill', '#fafafa')
            .attr('font-family', 'Inter Variable, sans-serif')
            .attr('font-size', 11)
            .attr('dx', (d) => nodeRadius(d) + 5)
            .attr('dy', 4)
            .attr('opacity', 0)
            .style('pointer-events', 'none')
            .call((sel) => sel.transition().duration(400).attr('opacity', 1)),
        (update) =>
          update
            .text((d) => d.name)
            .attr('dx', (d) => nodeRadius(d) + 5),
        (exit) =>
          exit.transition().duration(300).attr('opacity', 0).remove()
      );

    // ── Update simulation ──
    simulation.nodes(d3Nodes);
    simulation.force(
      'link',
      d3
        .forceLink<D3Node, D3Link>(d3Links)
        .id((d) => d.id)
        .distance(150)
    );

    // Mild reheat — existing nodes stay roughly in place, new nodes find their spot
    const hasNewNodes = d3Nodes.some((n) => n.x === undefined);
    simulation.alpha(hasNewNodes ? 0.5 : 0.3).restart();

    // Restore zoom transform
    if (zoomBehaviorRef.current && zoomTransformRef.current !== d3.zoomIdentity) {
      const svg = d3.select(svgRef.current);
      svg.call(zoomBehaviorRef.current.transform, zoomTransformRef.current);
    }
  }, [nodes, edges, dimensions, searchQuery]);

  // ── Resize observer ──
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
