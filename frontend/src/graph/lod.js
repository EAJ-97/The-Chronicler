import {
  EDGE_LABEL_MIN_ZOOM,
  NODE_LABEL_MIN_ZOOM,
  GRAPH_LABEL_SHARP_MIN_ZOOM,
  GRAPH_MAX_ZOOM,
} from './constants.js';

/**
 * Computes label LOD flags from zoom and graph size (renderer-agnostic).
 * @param {number} zoom
 * @param {number} nodeCount
 * @returns {{ hideEdgeLabels: boolean, hideNodeLabels: boolean }}
 */
export function computeGraphLod(zoom, nodeCount) {
  return {
    hideEdgeLabels: zoom < EDGE_LABEL_MIN_ZOOM || nodeCount > 100,
    hideNodeLabels: zoom < NODE_LABEL_MIN_ZOOM,
  };
}

/**
 * Human-readable zoom band for the debug HUD.
 * @param {number} z
 * @returns {string}
 */
export function zoomPerformanceZone(z) {
  if (z < NODE_LABEL_MIN_ZOOM) return 'far — labels hidden below 0.8×';
  if (z < EDGE_LABEL_MIN_ZOOM) return 'mid-far — edge labels culled';
  if (z < GRAPH_LABEL_SHARP_MIN_ZOOM) return 'approaching sharp band';
  if (z <= GRAPH_MAX_ZOOM) return 'sharp labels (0.8–1.5×)';
  return `max zoom (${GRAPH_MAX_ZOOM}× cap)`;
}
