/**
 * Canonical default theme matching production Chronicler styling.
 * @typedef {import('./schema.js').ChroniclerTheme} ChroniclerTheme
 */

/** @type {ChroniclerTheme} */
export const CHRONICLER_DEFAULT = {
  version: 1,
  presetId: 'chronicler',
  fonts: {
    body: 'Crimson Pro',
    display: 'Cinzel',
    brand: 'Cinzel Decorative',
  },
  colors: {
    shellBg: '#07080e',
    panelBg: '#0a0c14',
    cardBg: '#0f1219',
    topbarBg: '#0a0c14',
    textPrimary: '#e2d5bb',
    textMuted: 'rgba(226,213,187,0.55)',
    textAccent: 'rgba(200,148,58,0.85)',
    accent: '#c8943a',
    accentDim: '#a07030',
    border: 'rgba(200,148,58,0.12)',
    borderStrong: 'rgba(200,148,58,0.2)',
    success: '#6edbb0',
    error: '#e07070',
    scrollTrack: '#0d0f18',
    scrollThumb: '#2a2f3e',
    graphBg: '#07080e',
  },
  categories: {
    npc: '#c47f3a',
    location: '#3a8fc4',
    faction: '#8b2035',
    item: '#6b3ac4',
    event: '#3ac48b',
    lore: '#9a8535',
    general: '#4a5568',
  },
  edges: {
    canon: { color: '#c8943a', brightness: 0.2 },
    theory: { color: '#9664c8', brightness: 0.24 },
    ship: { color: '#d05090', brightness: 0.24 },
  },
  /** Site-wide UI scale (1 = default). Applied via root zoom for px-based layouts. */
  textScale: 1,
};
