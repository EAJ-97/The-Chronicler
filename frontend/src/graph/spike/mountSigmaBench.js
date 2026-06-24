import Graph from 'graphology';
import Sigma from 'sigma';
import { buildGraphModel } from '../elements.js';
import { connectionLineColor, DEFAULT_EDGE_THEME } from '../connections.js';
import { generateBenchmarkGraph } from './generateFixture.js';

/**
 * Mounts a sigma.js WebGL benchmark in the given container; returns teardown + FPS helpers.
 * @param {HTMLElement} container
 * @param {{ nodeCount?: number, showLabels?: boolean, onFps?: (fps: number) => void }} [opts]
 * @returns {{ destroy: () => void, sigma: Sigma, graph: Graph }}
 */
export function mountSigmaBench(container, opts = {}) {
  const nodeCount = opts.nodeCount ?? 500;
  const { notes, connections, positions } = generateBenchmarkGraph(nodeCount);
  const model = buildGraphModel(notes, connections, positions);

  const graph = new Graph({ multi: false, type: 'undirected' });
  const showLabels = opts.showLabels !== false;
  /** Screen-space radius — ~34px Cytoscape node diameter. */
  const nodeSize = 15;

  for (const n of model.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      x: n.x,
      y: n.y,
      size: nodeSize,
      color: n.color,
    });
  }
  for (const e of model.edges) {
    if (graph.hasEdge(e.source, e.target)) continue;
    graph.addEdgeWithKey(e.id, e.source, e.target, {
      size: 1.5,
      color: connectionLineColor(
        { connection_kind: e.kind },
        DEFAULT_EDGE_THEME,
      ),
    });
  }

  const sigma = new Sigma(graph, container, {
    renderLabels: showLabels,
    renderEdgeLabels: false,
    // Default is Math.sqrt — nodes grow when zooming in (we had wrongly pinned this to 1).
    labelDensity: showLabels ? 0.35 : 0,
    labelGridCellSize: 80,
    labelRenderedSizeThreshold: 4,
    labelSize: 11,
    labelFont: 'Cinzel, serif',
    labelWeight: 'normal',
    labelColor: { color: '#e2d5bb' },
    defaultNodeColor: '#c8943a',
    defaultEdgeColor: '#c8943a',
    backgroundColor: '#07080e',
    itemSizesReference: 'screen',
    minCameraRatio: 0.08,
    maxCameraRatio: 2.5,
  });

  sigma.getCamera().animatedReset({ duration: 0 });

  let frames = 0;
  let last = performance.now();
  let raf = 0;
  const onRender = () => {
    frames += 1;
    const now = performance.now();
    if (now - last >= 1000) {
      opts.onFps?.(frames);
      frames = 0;
      last = now;
    }
    raf = requestAnimationFrame(onRender);
  };
  raf = requestAnimationFrame(onRender);

  const destroy = () => {
    cancelAnimationFrame(raf);
    sigma.kill();
  };

  return { destroy, sigma, graph };
}
