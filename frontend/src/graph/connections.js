/** Per-kind edge appearance defaults (line, label, arrows share brightness). */
export const DEFAULT_EDGE_THEME = {
  canon: { color: '#c8943a', brightness: 0.2 },
  theory: { color: '#9664c8', brightness: 0.24 },
  ship: { color: '#d05090', brightness: 0.24 },
};

export const EDGE_KIND_META = [
  { key: 'canon', label: 'Canon' },
  { key: 'theory', label: 'Theory' },
  { key: 'ship', label: 'Ship' },
];

/**
 * Loads persisted edge theme from localStorage, merged with defaults.
 * @param {string} storageKey
 * @returns {typeof DEFAULT_EDGE_THEME}
 */
export function loadEdgeTheme(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_EDGE_THEME };
    const merged = { ...DEFAULT_EDGE_THEME };
    for (const { key } of EDGE_KIND_META) {
      if (raw[key] && typeof raw[key] === 'object') {
        merged[key] = {
          color: typeof raw[key].color === 'string' ? raw[key].color : merged[key].color,
          brightness: Number.isFinite(raw[key].brightness) ? raw[key].brightness : merged[key].brightness,
        };
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_EDGE_THEME };
  }
}

/**
 * Converts #rrggbb to rgba with the given alpha.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
export function hexToRgba(hex, alpha) {
  const h = String(hex || '#c8943a').replace('#', '');
  if (h.length !== 6) return `rgba(200,148,58,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Returns a Cytoscape edge class for connection_kind (canon / theory / ship).
 * @param {{ connection_kind?: string, is_speculative?: boolean|number }} conn
 * @returns {string}
 */
export function connectionKindClass(conn) {
  const k = conn.connection_kind;
  if (k === 'theory' || k === 'ship') return `kind-${k}`;
  if (k === 'canon') return 'kind-canon';
  if (conn.is_speculative) return 'kind-theory';
  return 'kind-canon';
}

/**
 * Returns a Cytoscape edge class for connection direction.
 * @param {{ direction?: string }} conn
 * @returns {string}
 */
export function connectionDirectionClass(conn) {
  const d = conn.direction || 'bidirectional';
  if (d === 'forward') return 'dir-forward';
  if (d === 'reverse') return 'dir-reverse';
  return 'dir-bidirectional';
}

/**
 * Resolves edge line color from connection kind and user theme.
 * @param {object} conn
 * @param {typeof DEFAULT_EDGE_THEME} [theme]
 * @returns {string}
 */
export function connectionLineColor(conn, theme = DEFAULT_EDGE_THEME) {
  const k = conn.connection_kind;
  if (k === 'theory') return theme.theory.color;
  if (k === 'ship') return theme.ship.color;
  return theme.canon.color;
}
