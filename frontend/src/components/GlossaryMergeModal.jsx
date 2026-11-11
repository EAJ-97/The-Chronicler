import { useEffect, useState } from 'react';
import api from '../api.js';

/**
 * Review glossary conflicts when moving a standalone campaign under a world.
 * @param {{ campaignId: number, worldId: number, onClose: () => void, onDone: () => void }} props
 */
export default function GlossaryMergeModal({ campaignId, worldId, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/glossary/merge-preview', {
          campaign_id: campaignId,
          world_id: worldId,
        });
        if (cancelled) return;
        setPreview(res.data);
        const init = {};
        for (const c of res.data.conflicts || []) {
          init[c.campaign_entry.id] = 'keep_world';
        }
        setResolutions(init);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || 'Failed to load merge preview');
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, worldId]);

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/glossary/merge-apply', {
        campaign_id: campaignId,
        world_id: worldId,
        resolutions: Object.entries(resolutions).map(([campaign_entry_id, action]) => ({
          campaign_entry_id: Number(campaign_entry_id),
          action,
        })),
      });
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div style={{
        width: '100%', maxWidth: 640, maxHeight: '85vh', overflowY: 'auto',
        background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
        border: '1px solid rgba(200,148,58,0.3)', borderRadius: 4, padding: 22,
      }}>
        <div style={{ fontFamily: 'var(--ch-font-display)', letterSpacing: '0.16em', color: 'var(--ch-accent)', fontSize: 13, marginBottom: 12 }}>
          GLOSSARY MERGE
        </div>
        <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.55)', fontSize: 14, marginBottom: 16 }}>
          Moving this campaign into a world merges its glossary. Resolve name conflicts below.
        </div>
        {error && <div style={{ color: 'rgba(220,100,100,0.85)', marginBottom: 12 }}>{error}</div>}
        {!preview && !error && <div style={{ color: 'rgba(226,213,187,0.4)' }}>Loading…</div>}
        {preview && (
          <>
            <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.7)', marginBottom: 12 }}>
              {(preview.auto_adds || []).length} entries will be added with no conflicts.
            </div>
            {(preview.conflicts || []).map((c) => (
              <div key={c.campaign_entry.id} style={{
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: 12, marginBottom: 10,
              }}>
                <div style={{ color: 'rgba(226,213,187,0.9)', marginBottom: 6 }}>
                  <strong>{c.campaign_entry.name}</strong>
                  {c.world_entry && <> vs World <strong>{c.world_entry.name}</strong></>}
                </div>
                <select
                  value={resolutions[c.campaign_entry.id] || 'keep_world'}
                  onChange={(e) => setResolutions((r) => ({ ...r, [c.campaign_entry.id]: e.target.value }))}
                  style={{
                    background: 'rgba(0,0,0,0.3)', color: 'rgba(226,213,187,0.85)',
                    border: '1px solid rgba(200,148,58,0.3)', borderRadius: 3, padding: '4px 8px',
                  }}
                >
                  <option value="keep_world">Keep World version</option>
                  <option value="keep_campaign">Keep Campaign version</option>
                  <option value="combine">Combine aliases & descriptions</option>
                </select>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                style={{
                  padding: '8px 14px', borderRadius: 3, cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'var(--ch-font-display)', fontSize: 9, letterSpacing: '0.12em',
                  border: '1px solid rgba(200,148,58,0.4)', background: 'rgba(200,148,58,0.15)', color: '#c8943a',
                }}
              >{busy ? 'Merging…' : 'Confirm merge & move'}</button>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                style={{
                  padding: '8px 14px', borderRadius: 3, cursor: 'pointer',
                  fontFamily: 'var(--ch-font-display)', fontSize: 9, letterSpacing: '0.12em',
                  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(226,213,187,0.5)',
                }}
              >Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
