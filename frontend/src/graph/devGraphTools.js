import { isDevSite } from '../utils/isDevSite.js';
import { LARGE_GRAPH_SCORE_THRESHOLD } from './constants.js';

/** localStorage key for synthetic benchmark node positions (dev fixture overlay). */
export const BENCH_FIXTURE_POS_KEY = 'chronicler_graph_bench_fixture';

const DEV_THRESHOLD_KEY = 'chronicler_dev_graph_score_threshold';

/**
 * Reads optional dev-only auto-WebGL score threshold from localStorage (port 3002 only).
 * @returns {number|null} null = use production default
 */
export function loadDevScoreThreshold() {
  if (!isDevSite()) return null;
  try {
    const v = localStorage.getItem(DEV_THRESHOLD_KEY);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Persists or clears the dev auto-WebGL threshold override.
 * @param {number|null} value - null removes override and restores production threshold
 */
export function saveDevScoreThreshold(value) {
  if (!isDevSite()) return;
  try {
    if (value == null) localStorage.removeItem(DEV_THRESHOLD_KEY);
    else localStorage.setItem(DEV_THRESHOLD_KEY, String(value));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Resolves the score threshold used by selectGraphRenderer for this session.
 * @param {number|null} devOverride
 * @returns {number}
 */
export function effectiveGraphScoreThreshold(devOverride) {
  if (isDevSite() && devOverride != null && Number.isFinite(devOverride)) {
    return devOverride;
  }
  return LARGE_GRAPH_SCORE_THRESHOLD;
}
