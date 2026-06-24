import {
  HOP_OPACITY,
  FLOOR_OPACITY,
  PATH_FIND_PICK_DIM_OPACITY,
} from './constants.js';
import { connectionLineColor, DEFAULT_EDGE_THEME, hexToRgba } from './connections.js';

/**
 * Resolves node opacity from tier / path / link-pick visual state.
 * @param {string} nodeId
 * @param {object} state
 * @returns {number}
 */
export function nodeOpacityFromState(nodeId, state) {
  const id = String(nodeId);
  if (state.highlightNewMode && state.newHighlightIds?.has(id)) return 1;
  if (state.linkSourceId === id) return 1;
  if (state.linkMode && state.linkDimOthers && state.linkSourceId && state.linkSourceId !== id) return 0.2;
  if (state.pathPickDim && state.pathSourceId && state.pathSourceId !== id) return PATH_FIND_PICK_DIM_OPACITY;
  if (state.pathNodeIds?.has(id)) return 1;
  if (state.pathFloor && state.pathNodeIds && !state.pathNodeIds.has(id)) return FLOOR_OPACITY;
  if (state.tierMap?.has(id)) {
    const tier = state.tierMap.get(id);
    return HOP_OPACITY[Math.min(tier, HOP_OPACITY.length - 1)] ?? FLOOR_OPACITY;
  }
  if (state.tierMap && state.tierMap.size > 0) return FLOOR_OPACITY;
  return 1;
}

/**
 * Resolves edge color and opacity for sigma rendering.
 * @param {object} edgeData
 * @param {typeof DEFAULT_EDGE_THEME} theme
 * @param {object} state
 * @returns {{ color: string, opacity: number, size: number, label: string, type: string }}
 */
export function edgeStyleFromState(edgeData, theme, state) {
  const kind = edgeData.kind || 'canon';
  const baseColor = connectionLineColor({ connection_kind: kind }, theme);
  const t = theme[kind] || DEFAULT_EDGE_THEME[kind];
  const brightness = Math.max(0.05, Math.min(1, t?.brightness ?? 0.2));
  let opacity = brightness;
  let size = 1.5;
  const label = edgeData.label || '';
  let type = 'arrow';

  const edgeKey = edgeData.id;
  if (state.pathEdgeIds?.has(edgeKey)) {
    opacity = 0.9;
    size = 3;
    return { color: 'rgba(200,148,58,0.85)', opacity, size, label, type };
  }
  if (state.pathFloor && state.pathNodeIds) {
    opacity = FLOOR_OPACITY;
  } else if (state.tierMap?.size) {
    const srcTier = state.tierMap.get(edgeData.source);
    const tgtTier = state.tierMap.get(edgeData.target);
    if (srcTier != null || tgtTier != null) {
      const tier = Math.max(srcTier ?? 0, tgtTier ?? 0);
      opacity = (HOP_OPACITY[Math.min(tier, HOP_OPACITY.length - 1)] ?? FLOOR_OPACITY) * brightness * 2.2;
      size = tier <= 1 ? 2 : 1.5;
    } else {
      opacity = FLOOR_OPACITY;
    }
  }

  if (edgeData.direction === 'bidirectional') type = 'line';
  return { color: baseColor, opacity: Math.min(1, opacity), size, label, type };
}

/**
 * Builds border highlight color for link-mode source nodes.
 * @param {string} nodeId
 * @param {object} state
 * @returns {string|null}
 */
export function linkSourceBorder(nodeId, state) {
  const id = String(nodeId);
  if (state.linkSourceId !== id) return null;
  if (state.linkMode === 'theory') return 'rgba(180,130,240,1)';
  if (state.linkMode === 'ship') return 'rgba(255,120,175,1)';
  if (state.linkMode === 'connect') return 'rgba(58,196,226,1)';
  return null;
}

/**
 * Node fill/border for highlight-new gold rings.
 * @param {string} nodeId
 * @param {object} state
 * @returns {{ borderColor: string, borderSize: number }|null}
 */
export function newHighlightStyle(nodeId, state) {
  if (!state.newHighlightIds?.has(String(nodeId))) return null;
  return {
    borderColor: state.newHighlightFlash ? '#f0d070' : '#e8c060',
    borderSize: state.newHighlightFlash ? 5 : 4,
  };
}

/**
 * Converts graph coordinates to screen pixels for edge editor overlay.
 * @param {import('sigma').default} sigma
 * @param {number} x
 * @param {number} y
 * @returns {{ x: number, y: number }}
 */
export function graphToScreen(sigma, x, y) {
  if (!sigma) return { x: 0, y: 0 };
  const { x: sx, y: sy } = sigma.graphToViewport({ x, y });
  const rect = sigma.getContainer().getBoundingClientRect();
  return { x: rect.left + sx, y: rect.top + sy };
}
