/**
 * Shared graph renderer contract — implemented by Cytoscape (small) and Sigma/WebGL (large).
 * Methods are optional until each phase lands; adapters throw or no-op when unsupported.
 *
 * @typedef {object} GraphRenderer
 * @property {(container: HTMLElement) => void} mount
 * @property {() => void} destroy
 * @property {(model: { nodes: object[], edges: object[] }) => void} setGraph
 * @property {() => Record<string, { x: number, y: number }>} getPositions
 * @property {(positions: Record<string, { x: number, y: number }>) => void} setPositions
 * @property {(nodeId?: string) => void} fit
 * @property {(nodeId: string) => void} centerOn
 * @property {() => number} getZoom
 * @property {(event: string, handler: Function) => void} on
 * @property {(event: string, handler: Function) => void} off
 */

export const GRAPH_RENDERER_EVENTS = {
  TAP_NODE: 'tapNode',
  TAP_EDGE: 'tapEdge',
  TAP_BACKGROUND: 'tapBackground',
  VIEWPORT: 'viewport',
  DRAG_END: 'dragEnd',
  RENDER: 'render',
};
