/**
 * Maps a ChroniclerTheme to CSS custom properties on a DOM element.
 * @param {import('./schema.js').ChroniclerTheme} theme
 * @param {HTMLElement} [target=document.documentElement]
 * @returns {Record<string, string>}
 */
export function themeToCssVarMap(theme) {
  const { colors, fonts, categories } = theme;
  const map = {
    '--ch-shell-bg': colors.shellBg,
    '--ch-panel-bg': colors.panelBg,
    '--ch-card-bg': colors.cardBg,
    '--ch-topbar-bg': colors.topbarBg,
    '--ch-text-primary': colors.textPrimary,
    '--ch-text-muted': colors.textMuted,
    '--ch-text-accent': colors.textAccent,
    '--ch-accent': colors.accent,
    '--ch-accent-dim': colors.accentDim,
    '--ch-border': colors.border,
    '--ch-border-strong': colors.borderStrong,
    '--ch-success': colors.success,
    '--ch-error': colors.error,
    '--ch-scroll-track': colors.scrollTrack,
    '--ch-scroll-thumb': colors.scrollThumb,
    '--ch-graph-bg': colors.graphBg,
    '--ch-font-body': `'${fonts.body}', Georgia, serif`,
    '--ch-font-display': `'${fonts.display}', serif`,
    '--ch-font-brand': `'${fonts.brand}', serif`,
    '--ch-cat-npc': categories.npc,
    '--ch-cat-location': categories.location,
    '--ch-cat-faction': categories.faction,
    '--ch-cat-item': categories.item,
    '--ch-cat-event': categories.event,
    '--ch-cat-lore': categories.lore,
    '--ch-cat-general': categories.general,
    '--ch-accent-18': hexAlpha(colors.accent, 0.18),
    '--ch-accent-20': hexAlpha(colors.accent, 0.2),
    '--ch-accent-30': hexAlpha(colors.accent, 0.3),
    '--ch-accent-40': hexAlpha(colors.accent, 0.4),
    '--ch-accent-50': hexAlpha(colors.accent, 0.5),
    '--ch-accent-55': hexAlpha(colors.accent, 0.55),
    '--ch-accent-65': hexAlpha(colors.accent, 0.65),
    '--ch-accent-70': hexAlpha(colors.accent, 0.7),
    '--ch-accent-85': hexAlpha(colors.accent, 0.85),
  };

  const textOpacities = [20, 25, 28, 30, 35, 40, 45, 50, 55, 60, 65, 75, 85, 88, 90];
  for (const op of textOpacities) {
    map[`--ch-text-primary-${op}`] = withAlpha(colors.textPrimary, op / 100);
  }

  return map;
}

/**
 * Applies theme CSS variables to a DOM element.
 * @param {import('./schema.js').ChroniclerTheme} theme
 * @param {HTMLElement} [target=document.documentElement]
 */
export function applyThemeCssVars(theme, target = document.documentElement) {
  const map = themeToCssVarMap(theme);
  for (const [key, value] of Object.entries(map)) {
    target.style.setProperty(key, value);
  }
}

/**
 * Updates PWA theme-color meta tag to match shell background.
 * @param {import('./schema.js').ChroniclerTheme} theme
 */
export function applyThemeColorMeta(theme) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', theme.colors.shellBg);
}

/**
 * Applies site-wide text/UI scale on a DOM element (typically #root).
 * Uses zoom so inline px font sizes scale consistently across the app.
 * @param {number} scale
 * @param {HTMLElement | null} [target]
 */
export function applyTextScale(scale, target = document.getElementById('root')) {
  if (!target) return;
  const s = Math.round(Number(scale) * 100) / 100;
  if (!Number.isFinite(s) || s <= 0) return;
  target.style.zoom = Math.abs(s - 1) < 0.001 ? '' : String(s);
}

/**
 * Converts #rrggbb to rgba with alpha.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexAlpha(hex, alpha) {
  const h = String(hex || '#c8943a').replace('#', '');
  if (h.length !== 6) return `rgba(200,148,58,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Returns rgba with adjusted alpha for hex or rgba input.
 * @param {string} color
 * @param {number} alpha
 * @returns {string}
 */
function withAlpha(color, alpha) {
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    return hexAlpha(color, alpha);
  }
  if (typeof color === 'string' && color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  return `rgba(226,213,187,${alpha})`;
}
