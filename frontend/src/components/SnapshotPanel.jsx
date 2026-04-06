import { useState, useEffect } from 'react';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

export default function SnapshotPanel({ folder, currentUser, dmCampaignIds, onClose, onRestored }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const [snapshots, setSnapshots] = useState([]);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [error, setError] = useState('');
  /** Optional label sent with the next POST /snapshots/:folderId (cleared after a successful save). */
  const [snapshotLabelDraft, setSnapshotLabelDraft] = useState('');

  const canManage = !!currentUser.is_admin || (dmCampaignIds || []).includes(folder.id);

  useEffect(() => {
    load();
  }, [folder.id]);

  // Tick cooldown down every second
  useEffect(() => {
    if (cooldownMs <= 0) return;
    const t = setTimeout(() => setCooldownMs(c => Math.max(0, c - 1000)), 1000);
    return () => clearTimeout(t);
  }, [cooldownMs]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/snapshots/${folder.id}`);
      setSnapshots(Array.isArray(res.data.snapshots) ? res.data.snapshots : []);
      setCooldownMs(res.data.cooldown_remaining_ms || 0);
    } catch (e) {
      console.error('Snapshot load error:', e.response?.data || e.message);
      setError(e.response?.data?.error || 'Failed to load snapshots.');
      setSnapshots([]);
    }
    setLoading(false);
  };

  const handleSnapshot = async () => {
    setSaving(true);
    setError('');
    try {
      const label = snapshotLabelDraft.trim();
      const res = await api.post(`/snapshots/${folder.id}`, label ? { label } : {});
      setSnapshots(Array.isArray(res.data.snapshots) ? res.data.snapshots : []);
      setCooldownMs(res.data.cooldown_remaining_ms || 0);
      setSnapshotLabelDraft('');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save snapshot.');
    }
    setSaving(false);
  };

  /**
   * Confirms and POSTs snapshot restore for this campaign. snapshotLabel is optional display text only.
   * @param {number} snapshotId
   * @param {string} savedAt - ISO datetime from API
   * @param {string|null|undefined} snapshotLabel
   */
  const handleRestore = async (snapshotId, savedAt, snapshotLabel) => {
    const when = new Date(savedAt).toLocaleString();
    const nameLine = snapshotLabel ? `\n\nLabel: "${snapshotLabel}"` : '';
    if (!window.confirm(`Restore campaign to snapshot from ${when}?${nameLine}\n\nNotes from the snapshot will have their content restored. Notes created after the snapshot will be kept.`)) return;
    setRestoring(snapshotId);
    setError('');
    try {
      await api.post(`/snapshots/${folder.id}/restore/${snapshotId}`);
      onRestored();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to restore snapshot.');
      setRestoring(null);
    }
  };

  const cooldownMins = Math.ceil(cooldownMs / 60000);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={isMobile ? {
        width: '100%', height: '100%', maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        background: '#0f1219', borderRadius: 0, border: 'none',
        paddingTop: 'env(safe-area-inset-top)',
      } : {
        width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)',
        borderRadius: '4px', boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '12px', letterSpacing: '0.1em', color: '#c8943a', marginBottom: '3px' }}>
              CAMPAIGN SNAPSHOTS
            </div>
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.6)' }}>
              {folder.title}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.3)', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Info */}
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.35)', lineHeight: '1.6', marginBottom: '16px' }}>
            Snapshots capture the entire campaign — all notes, folders, and content. Max 3 snapshots, 1 per hour.
            Restoring is non-destructive: existing notes are restored, newer notes are kept.
          </div>

          {error && (
            <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(224,112,112,0.7)', background: 'rgba(224,112,112,0.08)', border: '1px solid rgba(224,112,112,0.15)', borderRadius: '3px', padding: '8px 12px', marginBottom: '14px' }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.25)', textAlign: 'center', padding: '24px' }}>
              Loading...
            </div>
          ) : snapshots.length === 0 ? (
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.25)', textAlign: 'center', padding: '24px' }}>
              No snapshots yet for this campaign.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {snapshots.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '3px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.8)' }}>
                        {new Date(s.saved_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {i === 0 && <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(58,196,139,0.6)', background: 'rgba(58,196,139,0.08)', border: '1px solid rgba(58,196,139,0.15)', borderRadius: '10px', padding: '1px 6px' }}>LATEST</span>}
                    </div>
                    {s.label && (
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(200,148,58,0.85)', marginBottom: '6px', lineHeight: '1.35', wordBreak: 'break-word' }}>
                        {s.label}
                      </div>
                    )}
                    <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.3)' }}>
                      saved by {s.saved_by}
                    </div>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => handleRestore(s.id, s.saved_at, s.label)}
                      disabled={!!restoring}
                      style={{ padding: isMobile ? '10px 16px' : '6px 14px', minHeight: isMobile ? '44px' : 'auto', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: '3px', cursor: restoring ? 'default' : 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: restoring === s.id ? 'rgba(200,148,58,0.3)' : 'rgba(200,148,58,0.7)', flexShrink: 0, opacity: restoring && restoring !== s.id ? 0.4 : 1 }}
                    >
                      {restoring === s.id ? 'Restoring...' : 'Restore'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — snapshot button */}
        {canManage && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.35)', marginBottom: '6px' }}>
                SNAPSHOT LABEL (OPTIONAL)
              </label>
              <input
                type="text"
                value={snapshotLabelDraft}
                onChange={e => setSnapshotLabelDraft(e.target.value)}
                maxLength={200}
                placeholder="e.g. Before finale, Session 12 wrap"
                disabled={saving || cooldownMs > 0}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', fontFamily: 'Crimson Pro, serif', fontSize: '14px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px',
                  color: 'rgba(226,213,187,0.9)', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={handleSnapshot}
                disabled={saving || cooldownMs > 0}
                style={{
                  flex: 1, padding: '10px', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em',
                  background: cooldownMs > 0 ? 'rgba(255,255,255,0.02)' : 'rgba(200,148,58,0.1)',
                  border: `1px solid ${cooldownMs > 0 ? 'rgba(255,255,255,0.08)' : 'rgba(200,148,58,0.3)'}`,
                  borderRadius: '3px', cursor: cooldownMs > 0 ? 'default' : 'pointer',
                  color: cooldownMs > 0 ? 'rgba(226,213,187,0.25)' : '#c8943a',
                }}
              >
                {saving ? 'Saving...' : cooldownMs > 0 ? `📷 Cooldown — ${cooldownMins}m remaining` : '📷 Save Snapshot'}
              </button>
              <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.2)', textAlign: 'right', flexShrink: 0 }}>
                {snapshots.length}/3 slots used
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
