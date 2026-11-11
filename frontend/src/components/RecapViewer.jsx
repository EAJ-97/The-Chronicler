import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../api.js';
import { useTheme } from '../theme/useTheme.js';
import { buildMarkdownComponents } from '../utils/markdownComponents.jsx';
import { buildRecapReaderCss } from '../theme/markdownCss.js';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';

/**
 * Full-page session recap reader: generate, list versions, markdown read/edit.
 * @param {{ sessionId: number, sessionNum: number, onClose: () => void, aiEnabled: boolean, recapServerReady?: boolean, currentUser?: { id: number, is_admin?: boolean } }} props
 */
export default function RecapViewer({ sessionId, sessionNum, onClose, aiEnabled, recapServerReady = false, currentUser = null }) {
  const { theme } = useTheme();
  const [recaps, setRecaps] = useState([]);
  const [usage, setUsage] = useState(null);
  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tone, setTone] = useState('chronicle');
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState('');
  const [newRecapId, setNewRecapId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const mdComponents = useMemo(() => buildMarkdownComponents(), []);
  const readerCss = useMemo(() => buildRecapReaderCss(theme), [theme]);

  const load = async () => {
    try {
      const [recapsRes, usageRes, sourcesRes] = await Promise.all([
        api.get(`/recaps/session/${sessionId}`),
        api.get(`/recaps/usage/${sessionId}`),
        api.get(`/recaps/sources/${sessionId}`),
      ]);
      setRecaps(recapsRes.data);
      setUsage(usageRes.data);
      setSources(sourcesRes.data);
      setActiveIdx(0);
      setEditing(false);
      setEditText('');
    } catch (e) {
      setError('Failed to load recaps.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const handleGenerate = async () => {
    setError('');
    setGenerating(true);
    setEditing(false);
    try {
      const res = await api.post('/recaps/generate', { session_id: sessionId, tone });
      const fresh = [res.data.recap, ...recaps];
      setRecaps(fresh);
      setActiveIdx(0);
      setNewRecapId(res.data.recap.id);
      if (res.data.sources) setSources(res.data.sources);
      const usageRes = await api.get(`/recaps/usage/${sessionId}`);
      setUsage(usageRes.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const activeRecap = recaps[activeIdx];

  const canEditActive = !!activeRecap && !!currentUser && (
    usage?.is_admin
    || usage?.is_dm
    || activeRecap.generated_by === currentUser.id
  );

  const startEdit = () => {
    if (!activeRecap) return;
    setError('');
    setEditText(activeRecap.content || '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditText('');
    setError('');
  };

  const handleSave = async () => {
    if (!activeRecap) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      setError('Recap content cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/recaps/${activeRecap.id}`, { content: trimmed });
      setRecaps((prev) => prev.map((r) => (r.id === activeRecap.id ? res.data.recap : r)));
      setEditing(false);
      setEditText('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const canGenerate = aiEnabled && usage?.can_generate && !generating && !editing && recapServerReady;

  const usageLabel = () => {
    if (!usage) return '';
    if (usage.is_admin) return 'Admin — unlimited';
    if (usage.is_dm) return `DM — ${usage.remaining} of ${usage.allowed} remaining`;
    if (usage.standard_locked) return 'A party member already generated a recap';
    return `${usage.remaining} of ${usage.allowed} remaining`;
  };

  const sourcesLabel = () => {
    if (!sources) return '';
    const label = sources.session_number != null
      ? `Session ${sources.session_number}`
      : (sources.session_title || `Session ${sessionNum}`);
    const titleBit = sources.session_title && sources.session_number != null
      ? ` (${sources.session_title})`
      : '';
    const n = sources.entry_count ?? 0;
    return `Using ${label}${titleBit} — ${n} journal ${n === 1 ? 'entry' : 'entries'} (this session only)`;
  };

  const formatDate = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z')
    .toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const generateHint = () => {
    if (!aiEnabled || !usage?.can_generate) return '';
    if (recapServerReady) return '';
    return 'Configure Anthropic API key in Admin → AI.';
  };

  const selectRecap = (i) => {
    if (editing) return;
    setActiveIdx(i);
  };

  const barBtn = (active) => ({
    padding: '6px 12px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'var(--ch-font-display)',
    fontSize: 8,
    letterSpacing: '0.12em',
    border: `1px solid ${active ? 'var(--ch-border-strong)' : 'var(--ch-border)'}`,
    background: active ? 'rgba(200,148,58,0.12)' : 'transparent',
    color: active ? 'var(--ch-accent)' : 'var(--ch-text-muted)',
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ch-bg, #0a0c14)',
        color: 'var(--ch-text, rgba(226,213,187,0.9))',
      }}
    >
      <header
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--ch-border)',
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          background: 'var(--ch-surface, rgba(255,255,255,0.02))',
        }}
      >
        <button type="button" onClick={onClose} style={barBtn(false)} title="Back to journal">
          ← BACK
        </button>
        <div style={{ minWidth: 120 }}>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 12, letterSpacing: '0.18em', color: 'var(--ch-accent)' }}>
            SESSION {sessionNum} RECAPS
          </div>
          {usage && (
            <div style={{ fontFamily: 'var(--ch-font-body, Crimson Pro, serif)', fontSize: 12, color: 'var(--ch-text-muted)', marginTop: 2 }}>
              {usageLabel()}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        {aiEnabled && usage && !loading && (
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {['chronicle', 'summary'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => !editing && setTone(t)}
                  disabled={editing}
                  style={{ ...barBtn(tone === t), opacity: editing ? 0.5 : 1, cursor: editing ? 'not-allowed' : 'pointer' }}
                >
                  {t === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              title={generateHint() || 'Generate via Anthropic (server)'}
              style={{
                ...barBtn(canGenerate),
                opacity: canGenerate ? 1 : 0.4,
                cursor: canGenerate ? 'pointer' : 'not-allowed',
                background: canGenerate ? 'rgba(200,148,58,0.18)' : 'transparent',
              }}
            >
              {generating ? 'GENERATING…' : 'GENERATE'}
            </button>
          </>
        )}
        {activeRecap && canEditActive && !editing && (
          <button type="button" onClick={startEdit} style={barBtn(false)}>EDIT</button>
        )}
        {editing && (
          <>
            <button type="button" disabled={saving} onClick={handleSave} style={barBtn(true)}>
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
            <button type="button" disabled={saving} onClick={cancelEdit} style={barBtn(false)}>CANCEL</button>
          </>
        )}
      </header>

      {sources && (
        <div style={{
          flexShrink: 0,
          padding: '6px 16px',
          fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
          fontSize: 12,
          color: 'var(--ch-text-muted)',
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          {sourcesLabel()}
        </div>
      )}

      {error && (
        <div style={{
          flexShrink: 0,
          padding: '8px 16px',
          fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
          fontSize: 13,
          color: 'rgba(220,100,100,0.9)',
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          {error}
        </div>
      )}

      {!aiEnabled && (
        <div style={{
          flexShrink: 0,
          padding: '8px 16px',
          fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
          fontSize: 13,
          color: 'var(--ch-accent)',
          opacity: 0.7,
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          AI features are disabled. An admin can enable them in the Admin Panel.
        </div>
      )}

      {aiEnabled && usage?.can_generate && !recapServerReady && (
        <div style={{
          flexShrink: 0,
          padding: '8px 16px',
          fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
          fontSize: 13,
          color: 'var(--ch-accent)',
          opacity: 0.65,
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          No Anthropic API key is configured on the server. An admin can add one under Admin → AI.
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {recaps.length > 1 && (
          <aside style={{
            width: 160,
            flexShrink: 0,
            borderRight: '1px solid var(--ch-border)',
            overflowY: 'auto',
            padding: '8px 0',
          }}
          >
            {recaps.map((r, i) => (
              <div
                key={r.id}
                onClick={() => selectRecap(i)}
                style={{
                  padding: '10px 12px',
                  cursor: editing ? 'not-allowed' : 'pointer',
                  background: i === activeIdx ? 'rgba(200,148,58,0.08)' : 'transparent',
                  borderLeft: i === activeIdx ? '2px solid var(--ch-accent)' : '2px solid transparent',
                  opacity: editing && i !== activeIdx ? 0.45 : 1,
                }}
              >
                <div style={{
                  fontFamily: 'var(--ch-font-display)',
                  fontSize: 8,
                  letterSpacing: '0.1em',
                  color: i === activeIdx ? 'var(--ch-accent)' : 'var(--ch-text-muted)',
                  marginBottom: 3,
                }}
                >
                  {r.tone === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                  {r.id === newRecapId && <span style={{ marginLeft: 5, color: 'rgba(80,200,100,0.7)' }}>NEW</span>}
                </div>
                <div style={{ fontFamily: 'var(--ch-font-body, Crimson Pro, serif)', fontSize: 11, color: 'var(--ch-text-muted)' }}>
                  {r.author} · {formatDate(r.updated_at || r.created_at)}
                </div>
              </div>
            ))}
          </aside>
        )}

        <main style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--ch-text-muted)', fontFamily: 'var(--ch-font-body, Crimson Pro, serif)' }}>
              Loading…
            </div>
          ) : recaps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', maxWidth: 420, margin: '0 auto' }}>
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 11, letterSpacing: '0.2em', color: 'var(--ch-accent)', opacity: 0.5, marginBottom: 10 }}>
                NO RECAPS YET
              </div>
              <div style={{ fontFamily: 'var(--ch-font-body, Crimson Pro, serif)', fontSize: 15, color: 'var(--ch-text-muted)', lineHeight: 1.6 }}>
                {aiEnabled && usage?.can_generate && recapServerReady
                  ? 'Generate the first recap for this session above.'
                  : aiEnabled && usage?.can_generate
                    ? 'Configure Anthropic in Admin → AI, then generate.'
                    : aiEnabled
                      ? 'A party member has already used the recap for this session.'
                      : 'Enable AI features in the Admin Panel to generate recaps.'}
              </div>
            </div>
          ) : activeRecap && editing ? (
            <div style={{ maxWidth: '70ch', margin: '0 auto' }}>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                disabled={saving}
                style={{
                  width: '100%',
                  minHeight: '70vh',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  background: 'var(--ch-surface, rgba(0,0,0,0.25))',
                  border: '1px solid var(--ch-border-strong)',
                  borderRadius: 4,
                  color: 'var(--ch-text)',
                  fontSize: '1.05rem',
                  fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
                  lineHeight: 1.7,
                  padding: '16px 18px',
                  outline: 'none',
                }}
              />
            </div>
          ) : activeRecap ? (
            <div className="md-recap-reader">
              <div style={{
                fontFamily: 'var(--ch-font-display)',
                fontSize: 8,
                letterSpacing: '0.12em',
                color: 'var(--ch-text-muted)',
                marginBottom: 16,
              }}
              >
                {activeRecap.tone === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                {' · '}
                {activeRecap.author}
                {' · '}
                {formatDate(activeRecap.updated_at || activeRecap.created_at)}
                {activeRecap.id === newRecapId ? ' · JUST GENERATED' : ''}
              </div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={chroniclerUrlTransform}
                components={mdComponents}
              >
                {activeRecap.content || ''}
              </ReactMarkdown>
              <style>{readerCss}</style>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
