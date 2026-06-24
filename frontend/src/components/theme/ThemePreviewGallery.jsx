import { useState } from 'react';
import { ThemePreviewScope } from '../../theme/ThemeContext.jsx';
import { buildMarkdownCss } from '../../theme/markdownCss.js';
import { getCategoryColorFromTheme } from '../../theme/schema.js';
import { EDGE_KIND_META } from '../../graph/connections.js';

/** Switchable preview modes matching main app tabs. */
const PREVIEW_VIEWS = [
  { id: 'notes', label: 'Notes' },
  { id: 'web', label: 'Web' },
  { id: 'journal', label: 'Journal' },
  { id: 'timeline', label: 'Timeline' },
];

/**
 * Notes tab mock: topbar strip, sidebar, note title + markdown.
 * @param {import('../../theme/schema.js').ChroniclerTheme} theme
 */
function NotesPreviewMock({ theme }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--ch-shell-bg)' }}>
      <div style={{ height: 36, background: 'var(--ch-topbar-bg)', borderBottom: '1px solid var(--ch-border)', display: 'flex', alignItems: 'center', padding: '0 14px', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--ch-font-brand)', fontSize: 13, color: 'var(--ch-accent)' }}>The Chronicler</span>
        <span style={{ marginLeft: 14, fontFamily: 'var(--ch-font-display)', fontSize: 8, letterSpacing: '0.12em', color: 'var(--ch-accent)', background: 'var(--ch-accent-18)', padding: '3px 10px', borderRadius: 3 }}>NOTES</span>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: '28%', minWidth: 100, maxWidth: 160, background: 'var(--ch-panel-bg)', borderRight: '1px solid var(--ch-border)', padding: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 8, color: 'var(--ch-text-primary-50)', marginBottom: 8, letterSpacing: '0.1em' }}>CAMPAIGN</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: getCategoryColorFromTheme(theme, 'npc'), flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-text-primary-75)' }}>Elara</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: getCategoryColorFromTheme(theme, 'location'), flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-text-primary-55)' }}>Ruins</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: 16, overflow: 'hidden' }}>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 18, color: 'var(--ch-accent)', marginBottom: 4 }}>Elara Nightwhisper</div>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-text-primary-50)', marginBottom: 12, letterSpacing: '0.06em' }}>NPC / Character</div>
          <style>{buildMarkdownCss(theme)}</style>
          <div className="md-preview">
            <p>A **rogue** from the eastern wastes. She seeks the *Shattered Crown*.</p>
            <h3>Traits</h3>
            <p>Quick-witted and loyal to her party.</p>
            <p>Known for slipping past guards and reading ancient runes.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Web/graph tab mock: static SVG nodes and edges.
 * @param {import('../../theme/schema.js').ChroniclerTheme} theme
 */
function WebPreviewMock({ theme }) {
  const nodes = [
    { x: 90, y: 90, cat: 'npc', label: 'Elara' },
    { x: 240, y: 60, cat: 'location', label: 'Ruins' },
    { x: 390, y: 110, cat: 'faction', label: 'Guild' },
    { x: 300, y: 200, cat: 'lore', label: 'Crown' },
  ];
  const edges = [
    { from: 0, to: 1, kind: 'canon' },
    { from: 1, to: 2, kind: 'theory' },
    { from: 2, to: 3, kind: 'ship' },
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--ch-graph-bg)', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 14px', textAlign: 'center', fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-accent-70)', letterSpacing: '0.14em', flexShrink: 0 }}>
        CONNECTION WEB
      </div>
      <svg viewBox="0 0 480 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ flex: 1, display: 'block' }}>
        {edges.map((e, i) => {
          const a = nodes[e.from];
          const b = nodes[e.to];
          const t = theme.edges[e.kind];
          const dash = e.kind !== 'canon' ? '6 4' : undefined;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={t.color}
              strokeOpacity={t.brightness + 0.35}
              strokeWidth={2}
              strokeDasharray={dash}
            />
          );
        })}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={20} fill={getCategoryColorFromTheme(theme, n.cat)} fillOpacity={0.85} stroke="var(--ch-accent)" strokeOpacity={0.3} />
            <text x={n.x} y={n.y + 36} textAnchor="middle" fill="var(--ch-text-primary-75)" fontSize="10" fontFamily="var(--ch-font-display)">{n.label}</text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, padding: '8px 14px', flexShrink: 0 }}>
        {EDGE_KIND_META.map(({ key, label }) => (
          <span key={key} style={{ fontFamily: 'var(--ch-font-display)', fontSize: 8, color: theme.edges[key].color, letterSpacing: '0.06em' }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Journal tab mock: session header and entry lines.
 */
function JournalPreviewMock() {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--ch-shell-bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ch-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 11, letterSpacing: '0.14em', color: 'var(--ch-accent)' }}>SESSION JOURNAL</span>
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 9, color: 'var(--ch-text-primary-50)' }}>Campaign ▾</span>
      </div>
      <div style={{ flex: 1, padding: 16, overflow: 'hidden' }}>
        <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 10, color: 'var(--ch-accent-70)', letterSpacing: '0.1em', marginBottom: 10 }}>SESSION 12 — The Deep Vault</div>
        <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: 14, color: 'var(--ch-text-primary-75)', lineHeight: 1.65, marginBottom: 8, paddingLeft: 10, borderLeft: '2px solid var(--ch-border-strong)' }}>
          Party descended into the flooded catacombs beneath the ruins.
        </div>
        <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: 14, color: 'var(--ch-text-primary-55)', lineHeight: 1.65, paddingLeft: 24, marginBottom: 20 }}>
          Elara spotted trap runes along the eastern wall.
        </div>
        <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 10, color: 'var(--ch-accent-70)', letterSpacing: '0.1em', marginBottom: 10 }}>SESSION 11 — Road to Ashford</div>
        <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: 14, color: 'var(--ch-text-primary-55)', lineHeight: 1.65, paddingLeft: 10, borderLeft: '2px solid var(--ch-border)' }}>
          Merchants warned of bandits on the north road.
        </div>
      </div>
    </div>
  );
}

/**
 * Timeline tab mock: horizontal axis with event boxes.
 * @param {import('../../theme/schema.js').ChroniclerTheme} theme
 */
function TimelinePreviewMock({ theme }) {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--ch-shell-bg)', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--ch-accent-70)', marginBottom: 12, flexShrink: 0 }}>CAMPAIGN TIMELINE</div>
      <svg viewBox="0 0 480 160" width="100%" style={{ flex: 1, display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <line x1={20} y1={80} x2={460} y2={80} stroke="var(--ch-accent)" strokeOpacity={0.45} strokeWidth={2} />
        <text x={8} y={74} fill="var(--ch-text-primary-50)" fontSize="9" fontFamily="var(--ch-font-display)">Past</text>
        <text x={430} y={74} fill="var(--ch-text-primary-50)" fontSize="9" fontFamily="var(--ch-font-display)">Present</text>
        {[
          { x: 120, y: 35, cat: 'event', label: 'Siege' },
          { x: 320, y: 115, cat: 'lore', label: 'Crown Found' },
        ].map((box, i) => (
          <g key={i}>
            <line x1={box.x} y1={80} x2={box.x} y2={box.y + 16} stroke={getCategoryColorFromTheme(theme, box.cat)} strokeWidth={2} />
            <rect x={box.x - 48} y={box.y} width={96} height={32} rx={4} fill="var(--ch-card-bg)" stroke={getCategoryColorFromTheme(theme, box.cat)} strokeWidth={1.5} />
            <text x={box.x} y={box.y + 20} textAnchor="middle" fill="var(--ch-text-primary-75)" fontSize="9" fontFamily="var(--ch-font-display)">{box.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * Renders the active preview mock for the selected view id.
 * @param {string} viewId
 * @param {import('../../theme/schema.js').ChroniclerTheme} theme
 */
function PreviewContent({ viewId, theme }) {
  switch (viewId) {
    case 'web': return <WebPreviewMock theme={theme} />;
    case 'journal': return <JournalPreviewMock />;
    case 'timeline': return <TimelinePreviewMock theme={theme} />;
    default: return <NotesPreviewMock theme={theme} />;
  }
}

/**
 * Single switchable live preview using draft theme (non-interactive).
 * @param {{ theme: import('../../theme/schema.js').ChroniclerTheme }} props
 */
export default function ThemePreviewGallery({ theme }) {
  const [previewView, setPreviewView] = useState('notes');

  return (
    <ThemePreviewScope theme={theme} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: 8, letterSpacing: '0.14em', color: 'var(--ch-accent-65)' }}>
          PREVIEW
        </span>
        <select
          value={previewView}
          onChange={(e) => setPreviewView(e.target.value)}
          style={{
            flex: 1, maxWidth: 180, padding: '6px 10px', borderRadius: 3,
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ch-border-strong)',
            color: 'var(--ch-accent)', fontFamily: 'var(--ch-font-display)', fontSize: 9,
            letterSpacing: '0.1em', cursor: 'pointer',
          }}
        >
          {PREVIEW_VIEWS.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <div style={{
        flex: 1, minHeight: 280, borderRadius: 6, overflow: 'hidden',
        border: '1px solid var(--ch-border)', background: 'var(--ch-shell-bg)',
        pointerEvents: 'none',
      }}
      >
        <PreviewContent viewId={previewView} theme={theme} />
      </div>
    </ThemePreviewScope>
  );
}
