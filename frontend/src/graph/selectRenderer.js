import { LARGE_GRAPH_SCORE_THRESHOLD } from './constants.js';

/** @typedef {'auto'|'cytoscape'|'webgl'} GraphRendererPref */
/** @typedef {'cytoscape'|'webgl'} GraphRendererId */

/**
 * Scores graph size for renderer selection (higher = more benefit from WebGL).
 * @param {number} nodeCount
 * @param {number} edgeCount
 * @returns {number}
 */
export function graphSizeScore(nodeCount, edgeCount) {
  return nodeCount + edgeCount * 0.5;
}

/**
 * Picks cytoscape vs webgl based on graph size, device hints, and user preference.
 * @param {{ nodeCount: number, edgeCount: number, userPref?: GraphRendererPref, deviceMemoryGb?: number, isMobile?: boolean, scoreThreshold?: number }} opts
 * @returns {GraphRendererId}
 */
export function selectGraphRenderer(opts) {
  const { nodeCount, edgeCount, userPref = 'auto', deviceMemoryGb, isMobile, scoreThreshold } = opts;
  if (userPref === 'cytoscape') return 'cytoscape';
  if (userPref === 'webgl') return 'webgl';

  const score = graphSizeScore(nodeCount, edgeCount);
  const threshold = scoreThreshold ?? LARGE_GRAPH_SCORE_THRESHOLD;
  if (score >= threshold) return 'webgl';
  if (deviceMemoryGb && deviceMemoryGb <= 4 && nodeCount >= 80) return 'webgl';
  if (isMobile && nodeCount >= 100) return 'webgl';
  return 'cytoscape';
}

/**
 * Applies hysteresis for Auto mode so small graphs do not flip-flop at the threshold,
 * but large score jumps (e.g. dev fixture or campaign growth) still upgrade to WebGL.
 * @param {GraphRendererId} picked - fresh selection from selectGraphRenderer
 * @param {GraphRendererId|null} locked - engine locked for this session
 * @param {number} score - current graph size score
 * @param {number} threshold - auto WebGL threshold
 * @returns {GraphRendererId}
 */
export function resolveAutoRenderer(picked, locked, score, threshold) {
  if (!locked) return picked;
  if (locked === 'cytoscape' && score >= threshold) return 'webgl';
  if (locked === 'webgl' && score < threshold * 0.7) return 'cytoscape';
  return locked;
}

/**
 * Loads renderer preference from localStorage.
 * @param {string} storageKey
 * @returns {GraphRendererPref}
 */
export function loadRendererPref(storageKey) {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === 'cytoscape' || v === 'webgl' || v === 'auto') return v;
  } catch (e) {}
  return 'auto';
}

/**
 * Persists renderer preference.
 * @param {string} storageKey
 * @param {GraphRendererPref} pref
 */
export function saveRendererPref(storageKey, pref) {
  try { localStorage.setItem(storageKey, pref); } catch (e) {}
}
