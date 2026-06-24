import { useEffect, useRef, useState } from 'react';

/** Preset swatches for the in-app color picker. */
export const COLOR_PRESETS = [
  '#c8943a', '#d4a84a', '#e2d5bb',
  '#9664c8', '#7a50a8',
  '#d05090', '#c07088',
  '#6a9cb8', '#7ab87a', '#a08060',
];

/**
 * In-app color picker: preset swatches + hex field (Chronicler styling).
 * @param {{ value: string, onChange: (hex: string) => void, label: string }} props
 */
export function ChroniclerColorPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const wrapRef = useRef(null);

  useEffect(() => { setHexDraft(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const commitHex = () => {
    const v = hexDraft.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
    else setHexDraft(value);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`${label} color`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 32, height: 26, padding: 2, borderRadius: 4, cursor: 'pointer',
          background: 'var(--ch-shell-bg)', border: `1px solid ${open ? 'var(--ch-accent-55)' : 'var(--ch-accent-40)'}`,
        }}
      >
        <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: 2, background: value }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 50,
            background: 'var(--ch-card-bg)', border: '1px solid var(--ch-accent-40)',
            borderRadius: 6, padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.8)', width: 156,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.14em', color: 'var(--ch-accent-65)', marginBottom: 8 }}>
            {label.toUpperCase()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 10 }}>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set color ${c}`}
                onClick={() => { onChange(c); setOpen(false); }}
                style={{
                  width: 24, height: 24, borderRadius: 3, padding: 0, cursor: 'pointer',
                  background: c,
                  border: c.toLowerCase() === value.toLowerCase() ? '2px solid var(--ch-text-primary)' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: c.toLowerCase() === value.toLowerCase() ? '0 0 6px var(--ch-accent-40)' : 'none',
                }}
              />
            ))}
          </div>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.14em', color: 'var(--ch-accent-55)', marginBottom: 4 }}>HEX</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitHex(); setOpen(false); } }}
              onBlur={commitHex}
              style={{
                flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 3,
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ch-border-strong)',
                color: 'var(--ch-text-primary)', fontFamily: 'monospace', fontSize: 11, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => { commitHex(); setOpen(false); }}
              style={{
                padding: '4px 7px', borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--ch-font-display)', fontSize: '8px',
                background: 'var(--ch-accent-18)', border: '1px solid var(--ch-accent-30)', color: 'var(--ch-accent)',
              }}
            >
              SET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Brightness slider styled for theme edge controls.
 * @param {{ value: number, onChange: (n: number) => void, accentColor: string, label: string }} props
 */
export function ChroniclerBrightnessSlider({ value, onChange, accentColor, label }) {
  const pct = Math.round(value * 100);
  return (
    <input
      type="range"
      min={5}
      max={100}
      value={pct}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      style={{
        flex: 1,
        minWidth: 0,
        height: 20,
        margin: 0,
        cursor: 'pointer',
        accentColor,
      }}
    />
  );
}

/**
 * Labeled row with color picker for theme token editing.
 * @param {{ label: string, value: string, onChange: (hex: string) => void }} props
 */
export function ThemeColorRow({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: 'var(--ch-text-primary-75)', letterSpacing: '0.06em', width: 110, flexShrink: 0 }}>
        {label}
      </span>
      <ChroniclerColorPicker label={label} value={value} onChange={onChange} />
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ch-text-primary-50)' }}>{value}</span>
    </div>
  );
}

/**
 * Font role dropdown for theme customizer.
 * @param {{ label: string, value: string, options: string[], onChange: (v: string) => void }} props
 */
export function ThemeFontSelect({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.12em', color: 'var(--ch-accent-65)', marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 3,
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ch-border-strong)',
          color: 'var(--ch-text-primary)', fontFamily: 'var(--ch-font-body)', fontSize: 13,
        }}
      >
        {options.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Site-wide text/UI scale slider (85%–135% in 5% steps).
 * @param {{ value: number, onChange: (scale: number) => void }} props
 */
export function ThemeTextScaleSlider({ value, onChange }) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: 'var(--ch-text-primary-75)', letterSpacing: '0.06em', width: 110, flexShrink: 0 }}>
          Text scale
        </span>
        <input
          type="range"
          min={85}
          max={135}
          step={5}
          value={pct}
          aria-label="Site-wide text scale"
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          style={{ flex: 1, minWidth: 0, height: 20, margin: 0, cursor: 'pointer', accentColor: 'var(--ch-accent)' }}
        />
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 10, color: 'var(--ch-accent)', width: 42, textAlign: 'right', flexShrink: 0 }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}
