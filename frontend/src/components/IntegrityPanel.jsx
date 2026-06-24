import { useState, useMemo } from 'react';
import api from '../api.js';
import { getGraphCampaignRoots } from '../utils/campaignTree.js';

/**
 * Modal for DMs/admins: GET /api/integrity/:folderId — broken connections, orphan notes, bad permissions, orphan journal entries.
 * @param {{ onClose: () => void, notes: Array<object>, currentUser: object, dmCampaignIds: number[] }} props
 */
export default function IntegrityPanel({ onClose, notes, currentUser, dmCampaignIds = [] }) {
  const [folderId, setFolderId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState(null);

  const roots = useMemo(() => getGraphCampaignRoots(notes || []), [notes]);
  const isAdmin = !!currentUser?.is_admin;
  const canRun = isAdmin || (folderId != null && dmCampaignIds.includes(folderId));

  /**
   * Fetches the integrity report for the selected campaign folder.
   */
  const runScan = async () => {
    if (!folderId) return;
    setLoading(true);
    setErr('');
    setReport(null);
    try {
      const r = await api.get(`/integrity/${folderId}`);
      setReport(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--ch-panel-bg)',
          border: '1px solid rgba(200,148,58,0.25)',
          borderRadius: '8px',
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ch-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.18em', color: 'var(--ch-accent)' }}>
            DATA INTEGRITY
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(226,213,187,0.45)',
              fontSize: '22px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'var(--ch-text-primary-55)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Scan a campaign folder subtree for broken graph connections, notes pointing at missing parents, orphaned permission rows, and journal entries whose session is missing.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '16px' }}>
            <select
              value={folderId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setFolderId(v ? parseInt(v, 10) : null);
                setReport(null);
                setErr('');
              }}
              style={{
                flex: '1 1 220px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(200,148,58,0.25)',
                borderRadius: '4px',
                color: 'var(--ch-text-primary)',
                fontFamily: 'var(--ch-font-display)',
                fontSize: '11px',
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <option value="">— Select campaign —</option>
              {roots.map((f) => (
                <option key={f.id} value={f.id}>{f.title || 'Untitled'}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canRun || !folderId || loading}
              onClick={runScan}
              style={{
                padding: '10px 18px',
                borderRadius: '4px',
                border: '1px solid rgba(200,148,58,0.4)',
                background: canRun && folderId ? 'rgba(200,148,58,0.12)' : 'transparent',
                color: 'var(--ch-accent)',
                fontFamily: 'var(--ch-font-display)',
                fontSize: '9px',
                letterSpacing: '0.12em',
                cursor: canRun && folderId && !loading ? 'pointer' : 'not-allowed',
                opacity: canRun && folderId ? 1 : 0.45,
              }}
            >
              {loading ? 'SCANNING…' : 'RUN SCAN'}
            </button>
          </div>
          {!isAdmin && folderId && !dmCampaignIds.includes(folderId) && (
            <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.85)', margin: '0 0 12px' }}>
              You must be the DM of this campaign to run a scan.
            </p>
          )}
          {err && (
            <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', margin: '0 0 12px' }}>{err}</p>
          )}
          {report && (
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.85)', lineHeight: 1.55 }}>
              {[
                ['broken_connections', 'Broken connections'],
                ['orphan_notes', 'Orphan notes (bad parent)'],
                ['bad_permissions', 'Bad permission rows'],
                ['orphan_journal_entries', 'Orphan journal entries'],
              ].map(([key, label]) => {
                const arr = report[key] || [];
                return (
                  <div key={key} style={{ marginBottom: '16px' }}>
                    <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>
                      {label} ({arr.length})
                    </div>
                    {arr.length === 0 ? (
                      <div style={{ color: 'rgba(58,196,139,0.65)' }}>None found.</div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        {arr.slice(0, 50).map((row, i) => (
                          <li key={i} style={{ marginBottom: '4px' }}>
                            <code style={{ fontSize: '12px', color: 'rgba(200,180,240,0.9)' }}>{JSON.stringify(row)}</code>
                          </li>
                        ))}
                        {arr.length > 50 && <li>… {arr.length - 50} more</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
