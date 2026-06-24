import { CHRONICLER_DEFAULT } from './chroniclerDefault.js';

/** @typedef {{ body: string, display: string, brand: string }} ThemeFonts */
/** @typedef {{ shellBg: string, panelBg: string, cardBg: string, topbarBg: string, textPrimary: string, textMuted: string, textAccent: string, accent: string, accentDim: string, border: string, borderStrong: string, success: string, error: string, scrollTrack: string, scrollThumb: string, graphBg: string }} ThemeColors */
/** @typedef {{ npc: string, location: string, faction: string, item: string, event: string, lore: string, general: string }} ThemeCategories */
/** @typedef {{ canon: { color: string, brightness: number }, theory: { color: string, brightness: number }, ship: { color: string, brightness: number } }} ThemeEdges */
/**
 * @typedef {object} ChroniclerTheme
 * @property {number} version
 * @property {string} presetId
 * @property {ThemeFonts} fonts
 * @property {ThemeColors} colors
 * @property {ThemeCategories} categories
 * @property {ThemeEdges} edges
 * @property {number} textScale - Site-wide text/UI scale (0.85–1.35, default 1)
 */

export const THEME_VERSION = 1;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Validates and coerces a hex color string; returns fallback when invalid.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function asHex(value, fallback) {
  if (typeof value === 'string' && HEX_RE.test(value.trim())) return value.trim().toLowerCase();
  return fallback;
}

/**
 * Validates a color string (hex or rgba).
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function asColor(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const v = value.trim();
  if (HEX_RE.test(v)) return v.toLowerCase();
  if (/^rgba?\(/.test(v)) return v;
  return fallback;
}

/**
 * Deep-clones a theme object.
 * @param {ChroniclerTheme} theme
 * @returns {ChroniclerTheme}
 */
export function cloneTheme(theme) {
  return JSON.parse(JSON.stringify(theme));
}

/**
 * Merges a partial patch onto a base theme and normalizes the result.
 * @param {ChroniclerTheme} base
 * @param {Partial<ChroniclerTheme>} patch
 * @returns {ChroniclerTheme}
 */
export function mergeTheme(base, patch) {
  return normalizeTheme({
    ...base,
    ...patch,
    fonts: { ...base.fonts, ...(patch.fonts || {}) },
    colors: { ...base.colors, ...(patch.colors || {}) },
    categories: { ...base.categories, ...(patch.categories || {}) },
    textScale: patch.textScale !== undefined ? normalizeTextScale(patch.textScale, base.textScale) : base.textScale,
    edges: {
      canon: { ...base.edges.canon, ...(patch.edges?.canon || {}) },
      theory: { ...base.edges.theory, ...(patch.edges?.theory || {}) },
      ship: { ...base.edges.ship, ...(patch.edges?.ship || {}) },
    },
  });
}

/**
 * Normalizes unknown persisted or preset data into a valid ChroniclerTheme.
 * @param {unknown} raw
 * @returns {ChroniclerTheme}
 */
export function normalizeTheme(raw) {
  const d = CHRONICLER_DEFAULT;
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const fonts = src.fonts && typeof src.fonts === 'object' ? /** @type {Record<string, unknown>} */ (src.fonts) : {};
  const colors = src.colors && typeof src.colors === 'object' ? /** @type {Record<string, unknown>} */ (src.colors) : {};
  const categories = src.categories && typeof src.categories === 'object' ? /** @type {Record<string, unknown>} */ (src.categories) : {};
  const edges = src.edges && typeof src.edges === 'object' ? /** @type {Record<string, unknown>} */ (src.edges) : {};

  const edgeKind = (key) => {
    const e = edges[key] && typeof edges[key] === 'object' ? /** @type {Record<string, unknown>} */ (edges[key]) : {};
    const def = d.edges[key];
    return {
      color: asHex(e.color, def.color),
      brightness: Number.isFinite(Number(e.brightness)) ? Math.max(0, Math.min(1, Number(e.brightness))) : def.brightness,
    };
  };

  return {
    version: THEME_VERSION,
    presetId: typeof src.presetId === 'string' ? src.presetId : d.presetId,
    fonts: {
      body: typeof fonts.body === 'string' && fonts.body.trim() ? fonts.body.trim() : d.fonts.body,
      display: typeof fonts.display === 'string' && fonts.display.trim() ? fonts.display.trim() : d.fonts.display,
      brand: typeof fonts.brand === 'string' && fonts.brand.trim() ? fonts.brand.trim() : d.fonts.brand,
    },
    colors: {
      shellBg: asHex(colors.shellBg, d.colors.shellBg),
      panelBg: asHex(colors.panelBg, d.colors.panelBg),
      cardBg: asHex(colors.cardBg, d.colors.cardBg),
      topbarBg: asHex(colors.topbarBg, d.colors.topbarBg),
      textPrimary: asColor(colors.textPrimary, d.colors.textPrimary),
      textMuted: asColor(colors.textMuted, d.colors.textMuted),
      textAccent: asColor(colors.textAccent, d.colors.textAccent),
      accent: asHex(colors.accent, d.colors.accent),
      accentDim: asHex(colors.accentDim, d.colors.accentDim),
      border: asColor(colors.border, d.colors.border),
      borderStrong: asColor(colors.borderStrong, d.colors.borderStrong),
      success: asHex(colors.success, d.colors.success),
      error: asHex(colors.error, d.colors.error),
      scrollTrack: asHex(colors.scrollTrack, d.colors.scrollTrack),
      scrollThumb: asHex(colors.scrollThumb, d.colors.scrollThumb),
      graphBg: asHex(colors.graphBg, d.colors.graphBg),
    },
    categories: {
      npc: asHex(categories.npc, d.categories.npc),
      location: asHex(categories.location, d.categories.location),
      faction: asHex(categories.faction, d.categories.faction),
      item: asHex(categories.item, d.categories.item),
      event: asHex(categories.event, d.categories.event),
      lore: asHex(categories.lore, d.categories.lore),
      general: asHex(categories.general, d.categories.general),
    },
    edges: {
      canon: edgeKind('canon'),
      theory: edgeKind('theory'),
      ship: edgeKind('ship'),
    },
    textScale: normalizeTextScale(src.textScale, d.textScale),
  };
}

/**
 * Clamps and rounds a text scale factor to 5% steps (reduces subpixel blur from odd zoom values).
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeTextScale(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(0.85, Math.min(1.35, n));
  return Math.round(clamped * 20) / 20;
}

/**
 * Returns category color from a theme object.
 * @param {ChroniclerTheme} theme
 * @param {string} cat
 * @returns {string}
 */
export function getCategoryColorFromTheme(theme, cat) {
  return theme.categories[cat] || theme.categories.general;
}
