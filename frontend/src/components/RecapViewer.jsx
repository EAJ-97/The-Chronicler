import { useState, useEffect } from 'react';
import api from '../api.js';

/**
 * Modal: list session recaps and generate via server (Anthropic).
 * @param {{ sessionId: number, sessionNum: number, onClose: () => void, aiEnabled: boolean, recapServerReady?: boolean }} props
 */
export default function RecapViewer({ sessionId, sessionNum, onClose, aiEnabled, recapServerReady = false }) {
  const [recaps, setRecaps] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tone, setTone] = useState('chronicle');
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState('');
  const [newRecapId, setNewRecapId] = useState(null);

  /**
   * Fetches recaps and usage quota for this session; clears loading and sets list index to 0.
   * @returns {Promise<void>}
   */
  const load = async () => {
    try {
      const [recapsRes, usageRes] = await Promise.all([
        api.get(`/recaps/session/${sessionId}`),
        api.get(`/recaps/usage/${sessionId}`),
      ]);
      setRecaps(recapsRes.data);
      setUsage(usageRes.data);
      setActiveIdx(0);
    } catch (e) {
      setError('Failed to load recaps.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  /**
   * Calls POST /recaps/generate (Anthropic on server), prepends the new recap, refreshes usage.
   * @returns {Promise<void>}
   */
  const handleGenerate = async () => {
    setError('');
    setGenerating(true);
    try {
      const res = await api.post('/recaps/generate', { session_id: sessionId, tone });
      const fresh = [res.data.recap, ...recaps];
      setRecaps(fresh);
      setActiveIdx(0);
      setNewRecapId(res.data.recap.id);
      const usageRes = await api.get(`/recaps/usage/${sessionId}`);
      setUsage(usageRes.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = aiEnabled && usage?.can_generate && !generating && recapServerReady;

  const usageLabel = () => {
    if (!usage) return '';
    if (usage.is_admin) return 'Admin — unlimited';
    if (usage.is_dm) return `DM — ${usage.remaining} of ${usage.allowed} remaining`;
    if (usage.standard_locked) return 'A party member already generated a recap';
    return `${usage.remaining} of ${usage.allowed} remaining`;
  };

  const formatDate = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z')
    .toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const activeRecap = recaps[activeIdx];

  const generateHint = () => {
    if (!aiEnabled || !usage?.can_generate) return '';
    if (recapServerReady) return '';
    return 'Configure Anthropic API key in Admin → AI.';
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: '680px', maxHeight: '88vh',
        background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
        border: '1px solid rgba(200,148,58,0.3)', borderRadius: '4px',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 80px rgba(0,0,0,0.95)',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '13px', letterSpacing: '0.2em', color: '#c8943a' }}>
              SESSION {sessionNum} RECAPS
            </div>
            {usage && (
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.35)', marginTop: '3px' }}>
                {usageLabel()}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.3)', fontSize: '20px' }}>×</button>
        </div>

        {aiEnabled && usage && !loading && (
          <div style={{ padding: '12px 22px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, background: 'rgba(255,255,255,0.01)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['chronicle', 'summary'].map(t => (
                  <button key={t} type="button" onClick={() => setTone(t)} style={{
                    padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
                    fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                    background: tone === t ? 'rgba(200,148,58,0.15)' : 'transparent',
                    border: `1px solid ${tone === t ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: tone === t ? '#c8943a' : 'rgba(226,213,187,0.3)',
                  }}>
                    {t === 'chronicle' ? '📜 CHRONICLE' : '📋 SUMMARY'}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: '8px' }} />
              {error && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(220,100,100,0.8)', flexBasis: '100%' }}>
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                title={generateHint() || 'Generate via Anthropic (server)'}
                style={{
                  padding: '6px 16px', borderRadius: '3px', cursor: canGenerate ? 'pointer' : 'not-allowed',
                  fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                  background: canGenerate ? 'linear-gradient(135deg, rgba(200,148,58,0.25), rgba(200,148,58,0.1))' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${canGenerate ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  color: canGenerate ? '#c8943a' : 'rgba(226,213,187,0.2)',
                  transition: 'all 0.15s',
                }}>
                {generating ? '✦ GENERATING...' : '✦ GENERATE RECAP'}
              </button>
            </div>
            {aiEnabled && usage?.can_generate && !recapServerReady && (
              <div style={{ marginTop: '10px', fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(200,148,58,0.45)', lineHeight: 1.5 }}>
                No Anthropic API key is configured on the server. An admin can add one under <strong>Admin → AI</strong>.
              </div>
            )}
          </div>
        )}

        {!aiEnabled && (
          <div style={{ padding: '10px 22px', background: 'rgba(200,148,58,0.04)', borderBottom: '1px solid rgba(200,148,58,0.1)', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(200,148,58,0.5)', flexShrink: 0 }}>
            AI features are disabled. An admin can enable them in the Admin Panel.
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.3)' }}>Loading...</div>
          ) : recaps.length === 0 ? (
            <div style={{ padding: '60px 40px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.3)', marginBottom: '10px' }}>NO RECAPS YET</div>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.25)', lineHeight: '1.6' }}>
                {aiEnabled && usage?.can_generate && recapServerReady
                  ? 'Generate the first recap for this session above.'
                  : aiEnabled && usage?.can_generate
                  ? 'Configure Anthropic in Admin → AI, then generate.'
                  : aiEnabled
                  ? 'A party member has already used the recap for this session.'
                  : 'Enable AI features in the Admin Panel to generate recaps.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {recaps.length > 1 && (
                <div style={{ width: '180px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.05)', overflowY: 'auto', padding: '8px 0' }}>
                  {recaps.map((r, i) => (
                    <div key={r.id} onClick={() => setActiveIdx(i)} style={{
                      padding: '10px 14px', cursor: 'pointer',
                      background: i === activeIdx ? 'rgba(200,148,58,0.08)' : 'transparent',
                      borderLeft: i === activeIdx ? '2px solid rgba(200,148,58,0.5)' : '2px solid transparent',
                    }}>
                      <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: i === activeIdx ? '#c8943a' : 'rgba(226,213,187,0.4)', marginBottom: '3px' }}>
                        {r.tone === 'chronicle' ? '📜 CHRONICLE' : '📋 SUMMARY'}
                        {r.id === newRecapId && <span style={{ marginLeft: '5px', color: 'rgba(80,200,100,0.7)' }}>NEW</span>}
                      </div>
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '11px', color: 'rgba(226,213,187,0.3)' }}>
                        {r.author} · {formatDate(r.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeRecap && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                    <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', padding: '3px 10px', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px' }}>
                      {activeRecap.tone === 'chronicle' ? '📜 CHRONICLE' : '📋 SUMMARY'}
                    </span>
                    <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.3)' }}>
                      by {activeRecap.author} · {formatDate(activeRecap.created_at)}
                    </span>
                    {activeRecap.id === newRecapId && (
                      <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(80,200,100,0.7)', padding: '2px 8px', border: '1px solid rgba(80,200,100,0.2)', borderRadius: '3px' }}>JUST GENERATED</span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: activeRecap.tone === 'chronicle' ? '16px' : '14px',
                    lineHeight: activeRecap.tone === 'chronicle' ? '1.9' : '1.7',
                    color: 'rgba(226,213,187,0.85)',
                    whiteSpace: 'pre-wrap',
                    fontStyle: activeRecap.tone === 'chronicle' ? 'italic' : 'normal',
                  }}>
                    {activeRecap.content}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
