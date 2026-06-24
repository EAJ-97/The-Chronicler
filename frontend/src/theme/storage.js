import { CHRONICLER_DEFAULT } from './chroniclerDefault.js';
import { normalizeTheme } from './schema.js';
import { DEFAULT_EDGE_THEME } from '../graph/connections.js';

const STORAGE_PREFIX = 'chronicler_theme_';

/**
 * Builds localStorage key for a user's saved theme.
 * @param {number|string|null|undefined} userId
 * @returns {string}
 */
export function themeStorageKey(userId) {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

/**
 * Legacy graph edge theme key (migrated into global theme on load).
 * @param {number|string|null|undefined} userId
 * @returns {string}
 */
function legacyEdgeThemeKey(userId) {
  return `chronicler_graph_edge_theme_${userId || 'anon'}`;
}

/**
 * Attempts to read legacy edge theme from localStorage.
 * @param {number|string|null|undefined} userId
 * @returns {import('./schema.js').ChroniclerTheme['edges'] | null}
 */
function loadLegacyEdgeTheme(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(legacyEdgeThemeKey(userId)));
    if (!raw || typeof raw !== 'object') return null;
    const merged = { ...DEFAULT_EDGE_THEME };
    for (const key of ['canon', 'theory', 'ship']) {
      if (raw[key] && typeof raw[key] === 'object') {
        merged[key] = {
          color: typeof raw[key].color === 'string' ? raw[key].color : merged[key].color,
          brightness: Number.isFinite(raw[key].brightness) ? raw[key].brightness : merged[key].brightness,
        };
      }
    }
    return merged;
  } catch {
    return null;
  }
}

/**
 * Loads persisted theme for a user, migrating legacy edge colors when needed.
 * @param {number|string|null|undefined} userId
 * @returns {import('./schema.js').ChroniclerTheme}
 */
export function loadTheme(userId) {
  const key = themeStorageKey(userId);
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (raw && typeof raw === 'object') {
      const theme = normalizeTheme(raw);
      const legacy = loadLegacyEdgeTheme(userId);
      if (legacy && JSON.stringify(theme.edges) === JSON.stringify(CHRONICLER_DEFAULT.edges)) {
        theme.edges = legacy;
        saveTheme(userId, theme);
      }
      return theme;
    }
  } catch { /* fall through */ }

  const theme = normalizeTheme(CHRONICLER_DEFAULT);
  const legacy = loadLegacyEdgeTheme(userId);
  if (legacy) {
    theme.edges = legacy;
    saveTheme(userId, theme);
  }
  return theme;
}

/**
 * Persists theme to localStorage for a user.
 * @param {number|string|null|undefined} userId
 * @param {import('./schema.js').ChroniclerTheme} theme
 */
export function saveTheme(userId, theme) {
  try {
    localStorage.setItem(themeStorageKey(userId), JSON.stringify(normalizeTheme(theme)));
  } catch { /* quota */ }
}
