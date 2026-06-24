/**
 * Loads a persisted set of graph node ids from localStorage.
 * @param {string} storageKey
 * @returns {Set<string>}
 */
export function loadGraphNodeIdSet(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map(String));
  } catch {
    return new Set();
  }
}

/**
 * Persists a set of graph node ids to localStorage.
 * @param {string} storageKey
 * @param {Set<string>} ids
 */
export function saveGraphNodeIdSet(storageKey, ids) {
  try { localStorage.setItem(storageKey, JSON.stringify([...ids])); } catch (e) {}
}

/**
 * Builds per-campaign localStorage keys for graph state.
 * @param {number|string|null} campaignId
 * @param {number|string} [userId]
 */
export function graphStorageKeys(campaignId, userId = 'anon') {
  const camp = campaignId || 'all';
  const uid = userId || 'anon';
  return {
    positions: `chronicler_graph_positions_${camp}`,
    seen: `chronicler_graph_seen_${camp}`,
    manual: `chronicler_graph_manual_${camp}`,
    campaign: `chronicler_graph_campaign_${uid}`,
    is3d: `chronicler_graph_is3d_${uid}`,
    dmView: `chronicler_graph_dmview_${uid}`,
    zoomHud: `chronicler_graph_zoom_hud_${uid}`,
    edgeTheme: `chronicler_graph_edge_theme_${uid}`,
    rendererPref: `chronicler_graph_renderer_${uid}`,
  };
}

/**
 * Loads saved node positions for a campaign.
 * @param {string} posKey
 * @returns {Record<string, { x: number, y: number }>|null}
 */
export function loadGraphPositions(posKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(posKey));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Persists all node positions for a campaign.
 * @param {string} posKey
 * @param {Record<string, { x: number, y: number }>} positions
 */
export function saveGraphPositions(posKey, positions) {
  try { localStorage.setItem(posKey, JSON.stringify(positions)); } catch (e) {}
}
