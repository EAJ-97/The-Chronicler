import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../api.js';
import { useTheme } from '../theme/useTheme.js';
import { buildMarkdownComponents } from '../utils/markdownComponents.jsx';
import { buildRecapReaderCss } from '../theme/markdownCss.js';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';

/**
 * Full-page session recap reader: version menu when needed, Read/Edit toggle, X to exit.
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
  const [deleting, setDeleting] = useState(false);
  /** When true and multiple versions exist, show the picker instead of the reader. */
  const [showPicker, setShowPicker] = useState(false);

  const mdComponents = useMemo(() => buildMarkdownComponents(), []);
  const readerCss = useMemo(() => buildRecapReaderCss(theme), [theme]);

  const load = async () => {
    try {
      const [recapsRes, usageRes, sourcesRes] = await Promise.all([
        api.get(`/recaps/session/${sessionId}`),
        api.get(`/recaps/usage/${sessionId}`),
        api.get(`/recaps/sources/${sessionId}`),
      ]);
      const list = recapsRes.data || [];
      setRecaps(list);
      setUsage(usageRes.data);
      setSources(sourcesRes.data);
      setActiveIdx(0);
      setEditing(false);
      setEditText('');
      // Multiple versions → land on menu; one or none → reader / empty
      setShowPicker(list.length > 1);
    } catch (e) {
      setError('Failed to load recaps.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !editing && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, saving]);

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
      setShowPicker(false);
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

  const canDeleteActive = !!activeRecap && (usage?.is_admin || usage?.is_dm);

  const setReadMode = () => {
    setEditing(false);
    setEditText('');
    setError('');
  };

  const setEditMode = () => {
    if (!activeRecap || !canEditActive) return;
    setError('');
    setEditText(activeRecap.content || '');
    setEditing(true);
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

  const handleDelete = async () => {
    if (!activeRecap || !canDeleteActive) return;
    const label = activeRecap.tone === 'chronicle' ? 'chronicle' : 'summary';
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    setEditing(false);
    try {
      const deletedId = activeRecap.id;
      await api.delete(`/recaps/${deletedId}`);
      const next = recaps.filter((r) => r.id !== deletedId);
      setRecaps(next);
      setActiveIdx(0);
      if (newRecapId === deletedId) setNewRecapId(null);
      setShowPicker(next.length > 1);
      const usageRes = await api.get(`/recaps/usage/${sessionId}`);
      setUsage(usageRes.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const openVersion = (i) => {
    setActiveIdx(i);
    setShowPicker(false);
    setEditing(false);
    setEditText('');
    setError('');
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

  const barBtn = (active) => ({
    padding: '8px 12px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'var(--ch-font-display)',
    fontSize: 8,
    letterSpacing: '0.12em',
    border: `1px solid ${active ? 'var(--ch-border-strong)' : 'var(--ch-border)'}`,
    background: active ? 'rgba(200,148,58,0.12)' : 'transparent',
    color: active ? 'var(--ch-accent)' : 'var(--ch-text-muted)',
  });

  const inPicker = !loading && showPicker && recaps.length > 1;
  const inReader = !loading && !inPicker;

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
        paddingTop: 'var(--safe-top, 0px)',
        paddingBottom: 'var(--safe-bottom, 0px)',
        paddingLeft: 'var(--safe-left, 0px)',
        paddingRight: 'var(--safe-right, 0px)',
      }}
    >
      <header
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--ch-border)',
          padding: '10px 12px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          background: 'var(--ch-surface, rgba(255,255,255,0.02))',
        }}
      >
        {inReader && activeRecap && canEditActive ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" disabled={saving || deleting} onClick={setReadMode} style={barBtn(!editing)}>
              READ
            </button>
            <button type="button" disabled={saving || deleting} onClick={setEditMode} style={barBtn(editing)}>
              EDIT
            </button>
          </div>
        ) : (
          <div style={{ minWidth: 8 }} />
        )}

        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--ch-font-display)',
            fontSize: 11,
            letterSpacing: '0.16em',
            color: 'var(--ch-accent)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          >
            {inPicker ? 'CHOOSE RECAP' : `SESSION ${sessionNum}`}
          </div>
          {usage && !inPicker && (
            <div style={{
              fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
              fontSize: 11,
              color: 'var(--ch-text-muted)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            >
              {usageLabel()}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          style={{
            ...barBtn(false),
            minWidth: 40,
            minHeight: 40,
            padding: '8px 12px',
            fontSize: 16,
            lineHeight: 1,
            letterSpacing: 0,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          ×
        </button>
      </header>

      {inReader && editing && (
        <div style={{
          flexShrink: 0,
          padding: '8px 12px',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          <button type="button" disabled={saving} onClick={handleSave} style={barBtn(true)}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          <button type="button" disabled={saving} onClick={setReadMode} style={barBtn(false)}>CANCEL</button>
        </div>
      )}

      {inReader && !editing && (
        <div style={{
          flexShrink: 0,
          padding: '8px 12px',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          {recaps.length > 1 && (
            <button type="button" disabled={deleting} onClick={() => setShowPicker(true)} style={barBtn(false)}>
              VERSIONS
            </button>
          )}
          {aiEnabled && usage && (
            <>
              {['chronicle', 'summary'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  style={barBtn(tone === t)}
                >
                  {t === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                </button>
              ))}
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
          {activeRecap && canDeleteActive && (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              style={{
                ...barBtn(false),
                color: deleting ? 'var(--ch-text-muted)' : 'rgba(220,100,100,0.9)',
              }}
            >
              {deleting ? 'DELETING…' : 'DELETE'}
            </button>
          )}
        </div>
      )}

      {inPicker && (
        <div style={{
          flexShrink: 0,
          padding: '8px 12px',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--ch-border)',
        }}
        >
          {aiEnabled && usage && (
            <>
              {['chronicle', 'summary'].map((t) => (
                <button key={t} type="button" onClick={() => setTone(t)} style={barBtn(tone === t)}>
                  {t === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                </button>
              ))}
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
        </div>
      )}

      {sources && inReader && (
        <div style={{
          flexShrink: 0,
          padding: '6px 12px',
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
          padding: '8px 12px',
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
          padding: '8px 12px',
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
          padding: '8px 12px',
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

      <main style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', minHeight: 0, width: '100%', boxSizing: 'border-box' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--ch-text-muted)', fontFamily: 'var(--ch-font-body, Crimson Pro, serif)' }}>
            Loading…
          </div>
        ) : inPicker ? (
          <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
            <div style={{
              fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
              fontSize: 14,
              color: 'var(--ch-text-muted)',
              marginBottom: 14,
              lineHeight: 1.5,
            }}
            >
              {recaps.length} versions for session {sessionNum}. Pick one to read.
            </div>
            {recaps.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openVersion(i)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 14px',
                  marginBottom: 8,
                  borderRadius: 4,
                  border: '1px solid var(--ch-border)',
                  background: i === activeIdx ? 'rgba(200,148,58,0.1)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <div style={{
                  fontFamily: 'var(--ch-font-display)',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  color: 'var(--ch-accent)',
                  marginBottom: 4,
                }}
                >
                  {r.tone === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                  {r.id === newRecapId && <span style={{ marginLeft: 6, color: 'rgba(80,200,100,0.7)' }}>NEW</span>}
                </div>
                <div style={{ fontFamily: 'var(--ch-font-body, Crimson Pro, serif)', fontSize: 14, color: 'var(--ch-text-muted)' }}>
                  {r.author} · {formatDate(r.updated_at || r.created_at)}
                </div>
              </button>
            ))}
          </div>
        ) : recaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 16px', maxWidth: 420, margin: '0 auto' }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: 11, letterSpacing: '0.2em', color: 'var(--ch-accent)', opacity: 0.5, marginBottom: 10 }}>
              NO RECAPS YET
            </div>
            <div style={{ fontFamily: 'var(--ch-font-body, Crimson Pro, serif)', fontSize: 15, color: 'var(--ch-text-muted)', lineHeight: 1.6 }}>
              {aiEnabled && usage?.can_generate && recapServerReady
                ? 'Choose Chronicle or Summary above, then Generate.'
                : aiEnabled && usage?.can_generate
                  ? 'Configure Anthropic in Admin → AI, then generate.'
                  : aiEnabled
                    ? 'A party member has already used the recap for this session.'
                    : 'Enable AI features in the Admin Panel to generate recaps.'}
            </div>
            {aiEnabled && usage && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
                {['chronicle', 'summary'].map((t) => (
                  <button key={t} type="button" onClick={() => setTone(t)} style={barBtn(tone === t)}>
                    {t === 'chronicle' ? 'CHRONICLE' : 'SUMMARY'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  style={{
                    ...barBtn(canGenerate),
                    opacity: canGenerate ? 1 : 0.4,
                    background: canGenerate ? 'rgba(200,148,58,0.18)' : 'transparent',
                  }}
                >
                  {generating ? 'GENERATING…' : 'GENERATE'}
                </button>
              </div>
            )}
          </div>
        ) : activeRecap && editing ? (
          <div style={{ maxWidth: '70ch', margin: '0 auto', width: '100%' }}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={saving}
              style={{
                width: '100%',
                minHeight: '60vh',
                boxSizing: 'border-box',
                resize: 'vertical',
                background: 'var(--ch-surface, rgba(0,0,0,0.25))',
                border: '1px solid var(--ch-border-strong)',
                borderRadius: 4,
                color: 'var(--ch-text)',
                fontSize: '1.05rem',
                fontFamily: 'var(--ch-font-body, Crimson Pro, serif)',
                lineHeight: 1.7,
                padding: '14px 14px',
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
            {activeRecap.verify_report != null && activeRecap.verify_report !== '' && (
              <details style={{
                marginTop: 28,
                padding: '12px 14px',
                border: '1px dashed var(--ch-border)',
                borderRadius: 4,
                color: 'var(--ch-text-muted)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                lineHeight: 1.5,
              }}
              >
                <summary style={{
                  cursor: 'pointer',
                  fontFamily: 'var(--ch-font-display)',
                  fontSize: 8,
                  letterSpacing: '0.12em',
                  marginBottom: 8,
                }}
                >
                  VERIFY REPORT (DEBUG)
                </summary>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {typeof activeRecap.verify_report === 'string'
                    ? activeRecap.verify_report
                    : JSON.stringify(activeRecap.verify_report, null, 2)}
                </pre>
              </details>
            )}
            <style>{readerCss}</style>
          </div>
        ) : null}
      </main>
    </div>
  );
}
