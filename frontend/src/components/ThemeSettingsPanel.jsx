import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../theme/useTheme.js';
import { CHRONICLER_DEFAULT } from '../theme/chroniclerDefault.js';
import { FONT_OPTIONS } from '../theme/fonts.js';
import { THEME_PRESETS } from '../theme/presets.js';
import { cloneTheme, normalizeTheme } from '../theme/schema.js';
import { loadFontsForTheme } from '../theme/fonts.js';
import ThemePreviewGallery from './theme/ThemePreviewGallery.jsx';
import {
  ChroniclerBrightnessSlider,
  ChroniclerColorPicker,
  ThemeColorRow,
  ThemeFontSelect,
  ThemeTextScaleSlider,
} from './theme/ThemeControls.jsx';

const CATEGORY_KEYS = [
  { key: 'npc', label: 'NPC' },
  { key: 'location', label: 'Location' },
  { key: 'faction', label: 'Faction' },
  { key: 'item', label: 'Item' },
  { key: 'event', label: 'Event' },
  { key: 'lore', label: 'Lore' },
  { key: 'general', label: 'General' },
];

const EDGE_KEYS = [
  { key: 'canon', label: 'Canon' },
  { key: 'theory', label: 'Theory' },
  { key: 'ship', label: 'Ship' },
];

const SHELL_COLOR_FIELDS = [
  { path: 'shellBg', label: 'App background' },
  { path: 'panelBg', label: 'Panel background' },
  { path: 'cardBg', label: 'Card / modal' },
  { path: 'topbarBg', label: 'Top bar' },
  { path: 'graphBg', label: 'Graph canvas' },
];

const TEXT_COLOR_FIELDS = [
  { path: 'textPrimary', label: 'Primary text' },
  { path: 'textMuted', label: 'Muted text' },
  { path: 'accent', label: 'Accent / gold' },
  { path: 'accentDim', label: 'Accent dim' },
  { path: 'success', label: 'Success' },
  { path: 'error', label: 'Error' },
];

/**
 * Full-screen Appearance panel: presets, customizer, live preview; commits on Apply only.
 * @param {{ onClose: () => void }} props
 */
export default function ThemeSettingsPanel({ onClose }) {
  const {
    draftTheme,
    setDraftTheme,
    beginDraft,
    applyDraft,
    cancelDraft,
  } = useTheme();

  useEffect(() => {
    beginDraft();
    return () => cancelDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftTheme) loadFontsForTheme(draftTheme);
  }, [draftTheme]);

  if (!draftTheme) return null;

  const patchColors = (path, value) => {
    setDraftTheme({
      ...draftTheme,
      presetId: 'custom',
      colors: { ...draftTheme.colors, [path]: value },
    });
  };

  const patchCategory = (key, value) => {
    setDraftTheme({
      ...draftTheme,
      presetId: 'custom',
      categories: { ...draftTheme.categories, [key]: value },
    });
  };

  const patchEdge = (key, field, value) => {
    setDraftTheme({
      ...draftTheme,
      presetId: 'custom',
      edges: {
        ...draftTheme.edges,
        [key]: { ...draftTheme.edges[key], [field]: value },
      },
    });
  };

  const patchFont = (role, value) => {
    setDraftTheme({
      ...draftTheme,
      presetId: 'custom',
      fonts: { ...draftTheme.fonts, [role]: value },
    });
  };

  const patchTextScale = (value) => {
    setDraftTheme({
      ...draftTheme,
      presetId: 'custom',
      textScale: value,
    });
  };

  const applyPreset = (presetId) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (preset) setDraftTheme(cloneTheme(normalizeTheme(preset.theme)));
  };

  const handleApply = () => {
    applyDraft();
    onClose();
  };

  const handleCancel = () => {
    cancelDraft();
    onClose();
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'var(--ch-overlay)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'max(24px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
        overflowY: 'auto',
      }}
      onClick={handleCancel}
    >
      <div
        style={{
          width: 'min(1100px, calc(100vw - 24px))', height: 'min(85vh, 820px)', flexShrink: 0,
          background: 'var(--ch-card-bg)', border: '1px solid var(--ch-border-strong)',
          borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--ch-border)', flexShrink: 0,
        }}
        >
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 12, letterSpacing: '0.2em', color: 'var(--ch-accent)' }}>
            APPEARANCE
          </div>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--ch-text-primary-50)', fontSize: 22, lineHeight: 1, padding: '0 4px',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <div style={{
            width: 'min(380px, 42%)', borderRight: '1px solid var(--ch-border)',
            overflowY: 'auto', padding: '16px 18px',
          }}
          >
            <Section title="Presets">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 4, cursor: 'pointer',
                      background: draftTheme.presetId === p.id ? 'var(--ch-accent-18)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${draftTheme.presetId === p.id ? 'var(--ch-accent-40)' : 'var(--ch-border)'}`,
                    }}
                  >
                    <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 10, color: 'var(--ch-accent)', letterSpacing: '0.08em' }}>{p.name}</div>
                    <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: 11, color: 'var(--ch-text-primary-55)', marginTop: 3, lineHeight: 1.4 }}>{p.description}</div>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Fonts">
              <ThemeFontSelect label="Body (note prose)" value={draftTheme.fonts.body} options={FONT_OPTIONS.body} onChange={(v) => patchFont('body', v)} />
              <ThemeFontSelect label="Display (UI labels)" value={draftTheme.fonts.display} options={FONT_OPTIONS.display} onChange={(v) => patchFont('display', v)} />
              <ThemeFontSelect label="Brand (logo)" value={draftTheme.fonts.brand} options={FONT_OPTIONS.brand} onChange={(v) => patchFont('brand', v)} />
            </Section>

            <Section title="Text size">
              <ThemeTextScaleSlider
                value={draftTheme.textScale ?? 1}
                onChange={patchTextScale}
              />
              <p style={{ fontFamily: 'var(--ch-font-body)', fontSize: 12, color: 'var(--ch-text-primary-50)', lineHeight: 1.5, margin: '8px 0 0' }}>
                Scales all text and UI site-wide. If type looks fuzzy, use 5% steps (default 100%) or try a stronger primary text color above.
              </p>
            </Section>

            <Section title="Shell colors">
              {SHELL_COLOR_FIELDS.map(({ path, label }) => (
                <ThemeColorRow key={path} label={label} value={draftTheme.colors[path]} onChange={(v) => patchColors(path, v)} />
              ))}
            </Section>

            <Section title="Text & accent">
              {TEXT_COLOR_FIELDS.map(({ path, label }) => (
                <ThemeColorRow key={path} label={label} value={draftTheme.colors[path]} onChange={(v) => patchColors(path, v)} />
              ))}
            </Section>

            <Section title="Category colors">
              {CATEGORY_KEYS.map(({ key, label }) => (
                <ThemeColorRow key={key} label={label} value={draftTheme.categories[key]} onChange={(v) => patchCategory(key, v)} />
              ))}
            </Section>

            <Section title="Graph edges">
              {EDGE_KEYS.map(({ key, label }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-text-primary-75)', marginBottom: 6 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ChroniclerColorPicker label={label} value={draftTheme.edges[key].color} onChange={(c) => patchEdge(key, 'color', c)} />
                    <ChroniclerBrightnessSlider
                      label={`${label} brightness`}
                      accentColor={draftTheme.edges[key].color}
                      value={draftTheme.edges[key].brightness}
                      onChange={(b) => patchEdge(key, 'brightness', b)}
                    />
                    <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 8, color: 'var(--ch-accent-55)', width: 28 }}>
                      {Math.round(draftTheme.edges[key].brightness * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </Section>
          </div>

          <div style={{ flex: 1, padding: 16, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: 12, color: 'var(--ch-text-primary-50)', marginBottom: 10, lineHeight: 1.5 }}>
              Changes apply when you press <strong style={{ color: 'var(--ch-text-primary-65)', fontWeight: 500 }}>Apply theme</strong>. Use the preview dropdown to check each tab.
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ThemePreviewGallery theme={draftTheme} />
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '12px 20px', borderTop: '1px solid var(--ch-border)', flexShrink: 0,
        }}
        >
          <button
            type="button"
            onClick={() => setDraftTheme(cloneTheme(CHRONICLER_DEFAULT))}
            style={footerBtnStyle(false)}
          >
            Reset to default
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleCancel} style={footerBtnStyle(false)}>Cancel</button>
            <button type="button" onClick={handleApply} style={footerBtnStyle(true)}>Apply theme</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Section heading wrapper for customizer groups.
 * @param {{ title: string, children: import('react').ReactNode }} props
 */
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontFamily: 'var(--ch-font-display)', fontSize: 8, letterSpacing: '0.18em',
        color: 'var(--ch-accent-70)', marginBottom: 10, paddingBottom: 6,
        borderBottom: '1px solid var(--ch-border)',
      }}
      >
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

/**
 * Footer button styles for cancel/apply actions.
 * @param {boolean} primary
 * @returns {import('react').CSSProperties}
 */
function footerBtnStyle(primary) {
  return {
    padding: '8px 16px', borderRadius: 4, cursor: 'pointer',
    fontFamily: 'var(--ch-font-display)', fontSize: 9, letterSpacing: '0.12em',
    background: primary ? 'var(--ch-accent-20)' : 'transparent',
    border: `1px solid ${primary ? 'var(--ch-accent-50)' : 'var(--ch-border-strong)'}`,
    color: primary ? 'var(--ch-accent)' : 'var(--ch-text-primary-65)',
  };
}
