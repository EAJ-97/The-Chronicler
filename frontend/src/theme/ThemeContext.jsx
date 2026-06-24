import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { CHRONICLER_DEFAULT } from './chroniclerDefault.js';
import { applyThemeColorMeta, applyThemeCssVars, applyTextScale } from './cssVars.js';
import { loadFontsForTheme } from './fonts.js';
import { cloneTheme, getCategoryColorFromTheme, normalizeTheme } from './schema.js';
import { setCategoryColors } from './categoryColors.js';
import { loadTheme, saveTheme, themeStorageKey } from './storage.js';

/** @typedef {import('./schema.js').ChroniclerTheme} ChroniclerTheme */

/**
 * @typedef {object} ThemeContextValue
 * @property {ChroniclerTheme} theme - Applied theme (live across the app)
 * @property {ChroniclerTheme | null} draftTheme - Draft while Appearance panel is open
 * @property {(theme: ChroniclerTheme) => void} setDraftTheme
 * @property {() => void} beginDraft - Copy applied theme into draft
 * @property {() => void} applyDraft - Persist draft and apply site-wide
 * @property {() => void} cancelDraft - Discard draft
 * @property {() => void} resetDraftToDefault - Set draft to Chronicler default
 * @property {(cat: string) => string} getCategoryColor
 * @property {boolean} isDraftOpen
 */

export const ThemeContext = createContext(/** @type {ThemeContextValue | null} */ (null));

/**
 * Applies theme tokens to the document (CSS vars, fonts, PWA meta).
 * @param {ChroniclerTheme} theme
 */
export function applyThemeToDocument(theme) {
  applyThemeCssVars(theme);
  loadFontsForTheme(theme);
  applyThemeColorMeta(theme);
  applyTextScale(theme.textScale ?? 1);
}

/**
 * Provides site-wide theme state; persists per user in localStorage.
 * @param {{ userId?: number|string|null, children: import('react').ReactNode }} props
 */
export function ThemeProvider({ userId = null, children }) {
  const [theme, setTheme] = useState(() => loadTheme(userId));
  const [draftTheme, setDraftThemeState] = useState(/** @type {ChroniclerTheme | null} */ (null));

  useEffect(() => {
    const loaded = loadTheme(userId);
    setTheme(loaded);
    setCategoryColors(loaded.categories);
    applyThemeToDocument(loaded);
  }, [userId]);

  useEffect(() => {
    setCategoryColors(theme.categories);
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const key = themeStorageKey(userId);
    const onStorage = (e) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const next = normalizeTheme(JSON.parse(e.newValue));
        setTheme(next);
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const setDraftTheme = useCallback((next) => {
    setDraftThemeState(normalizeTheme(next));
  }, []);

  const beginDraft = useCallback(() => {
    setDraftThemeState(cloneTheme(theme));
  }, [theme]);

  const applyDraft = useCallback(() => {
    if (!draftTheme) return;
    const next = normalizeTheme({ ...draftTheme, presetId: draftTheme.presetId || 'custom' });
    saveTheme(userId, next);
    setTheme(next);
    setDraftThemeState(null);
  }, [draftTheme, userId]);

  const cancelDraft = useCallback(() => {
    setDraftThemeState(null);
  }, []);

  const resetDraftToDefault = useCallback(() => {
    setDraftThemeState(cloneTheme(CHRONICLER_DEFAULT));
  }, []);

  const getCategoryColor = useCallback(
    (cat) => getCategoryColorFromTheme(theme, cat),
    [theme],
  );

  const value = useMemo(() => ({
    theme,
    draftTheme,
    setDraftTheme,
    beginDraft,
    applyDraft,
    cancelDraft,
    resetDraftToDefault,
    getCategoryColor,
    isDraftOpen: draftTheme != null,
  }), [theme, draftTheme, setDraftTheme, beginDraft, applyDraft, cancelDraft, resetDraftToDefault, getCategoryColor]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Scoped provider for theme preview panels (draft vars on a wrapper only).
 * @param {{ theme: ChroniclerTheme, children: import('react').ReactNode, style?: import('react').CSSProperties }} props
 */
export function ThemePreviewScope({ theme, children, style = {} }) {
  const ref = useCallback((el) => {
    if (el) {
      applyThemeCssVars(theme, el);
      applyTextScale(theme.textScale ?? 1, el);
    }
  }, [theme]);

  return (
    <div ref={ref} style={{ ...style, color: 'var(--ch-text-primary)', fontFamily: 'var(--ch-font-body)' }}>
      {children}
    </div>
  );
}
