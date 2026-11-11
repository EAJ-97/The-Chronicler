import { useState, useEffect, useMemo } from 'react';
import api from '../api.js';

const TYPES = ['npc', 'place', 'item', 'faction', 'other'];

/**
 * Glossary editor for a World or standalone Campaign scope.
 * @param {{ scopeNoteId: number, notes: object[], currentUser: object, onRefreshNotes?: () => void }} props
 */
export default function GlossaryPage({ scopeNoteId, notes, currentUser, onRefreshNotes }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'npc', description: '', aliases: '' });
  const [editId, setEditId] = useState(null);
  const [scanSessionId, setScanSessionId] = useState('');

  const campaigns = useMemo(() => {
    const scope = notes.find((n) => n.id === scopeNoteId);
    if (!scope) return [];
    if (scope.is_world) {
      return notes.filter((n) => n.parent_id === scopeNoteId && n.is_folder && n.is_campaign);
    }
    return scope.is_folder ? [scope] : [];
  }, [notes, scopeNoteId]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/glossary/by-scope/${scopeNoteId}`);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load glossary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [scopeNoteId]);

  const approved = useMemo(() => {
    if (!data?.entries) return [];
    return data.entries.filter((e) => e.status === 'approved');
  }, [data]);

  const suggestions = useMemo(() => {
    if (!data?.entries) return [];
    return data.entries.filter((e) => e.status === 'suggested');
  }, [data]);

  const filteredApproved = useMemo(() => {
    let list = approved;
    if (campaignFilter === 'world') list = list.filter((e) => e.campaign_id == null);
    else if (campaignFilter !== 'all') list = list.filter((e) => String(e.campaign_id) === String(campaignFilter));
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(qq)
        || (e.description || '').toLowerCase().includes(qq)
        || (e.aliases || []).some((a) => (a.alias || a).toLowerCase().includes(qq))
      );
    }
    return list;
  }, [approved, campaignFilter, q]);

  const byType = useMemo(() => {
    const map = {};
    for (const t of TYPES) map[t] = [];
    for (const e of filteredApproved) {
      (map[e.type] || (map[e.type] = [])).push(e);
    }
    return map;
  }, [filteredApproved]);

  const addEntry = async () => {
    if (!data?.can_edit) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/glossary/${data.glossary.id}/entries`, {
        name: draft.name,
        type: draft.type,
        description: draft.description,
        aliases: draft.aliases.split(',').map((s) => s.trim()).filter(Boolean),
        campaign_id: campaignFilter !== 'all' && campaignFilter !== 'world' ? Number(campaignFilter) : null,
      });
      setDraft({ name: '', type: 'npc', description: '', aliases: '' });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (entry) => {
    setBusy(true);
    try {
      await api.put(`/glossary/entries/${entry.id}`, {
        name: entry.name,
        type: entry.type,
        description: entry.description,
        aliases: (entry.aliases || []).map((a) => a.alias || a),
        campaign_id: entry.campaign_id,
        status: 'approved',
      });
      setEditId(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const runScan = async () => {
    if (!scanSessionId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/glossary/scan/${scanSessionId}`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Scan failed, try again');
    } finally {
      setBusy(false);
    }
  };

  const buildPast = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/glossary/${data.glossary.id}/build-from-past`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Build failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'rgba(226,213,187,0.4)', fontFamily: 'Crimson Pro, serif' }}>Loading glossary…</div>;
  }
  if (!data) {
    return <div style={{ padding: 24, color: 'rgba(220,100,100,0.8)' }}>{error || 'Unavailable'}</div>;
  }

  const S = {
    wrap: { padding: '20px 28px', maxWidth: 900, overflowY: 'auto', height: '100%' },
    h1: { fontFamily: 'var(--ch-font-display)', letterSpacing: '0.18em', color: 'var(--ch-accent)', fontSize: 14, marginBottom: 8 },
    muted: { fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.45)', fontSize: 13, marginBottom: 16 },
    row: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' },
    input: {
      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: 3,
      color: 'rgba(226,213,187,0.9)', padding: '6px 10px', fontFamily: 'Crimson Pro, serif', fontSize: 14,
    },
    btn: {
      padding: '6px 12px', borderRadius: 3, cursor: 'pointer',
      fontFamily: 'var(--ch-font-display)', fontSize: 8, letterSpacing: '0.12em',
      border: '1px solid rgba(200,148,58,0.35)', background: 'rgba(200,148,58,0.1)', color: 'var(--ch-accent)',
    },
    btnGhost: {
      padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
      fontFamily: 'var(--ch-font-display)', fontSize: 8, letterSpacing: '0.1em',
      border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(226,213,187,0.55)',
    },
    card: {
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4, padding: '10px 12px', marginBottom: 8,
      background: 'rgba(255,255,255,0.02)',
    },
  };

  return (
    <div style={S.wrap}>
      <div style={S.h1}>GLOSSARY</div>
      <div style={S.muted}>Canonical names for this {notes.find((n) => n.id === scopeNoteId)?.is_world ? 'world' : 'campaign'}. Used by AI recaps for spelling.</div>
      {error && <div style={{ color: 'rgba(220,100,100,0.85)', marginBottom: 12, fontFamily: 'Crimson Pro, serif' }}>{error}</div>}

      <div style={S.row}>
        <input style={{ ...S.input, flex: 1, minWidth: 160 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={S.input} value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
          <option value="all">All campaigns</option>
          <option value="world">World-wide only</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>

      {data.can_edit && (
        <div style={{ ...S.card, marginBottom: 18 }}>
          <div style={{ ...S.h1, fontSize: 11, marginBottom: 10 }}>ADD ENTRY</div>
          <div style={S.row}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select style={S.input} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Short description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div style={S.row}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Aliases (comma-separated)" value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} />
            <button type="button" style={S.btn} disabled={busy || !draft.name.trim()} onClick={addEntry}>Add</button>
          </div>
        </div>
      )}

      {data.can_edit && (
        <div style={{ ...S.card, marginBottom: 18 }}>
          <div style={{ ...S.h1, fontSize: 11, marginBottom: 10 }}>AI SCAN</div>
          <div style={S.row}>
            <input style={{ ...S.input, width: 120 }} placeholder="Session id" value={scanSessionId} onChange={(e) => setScanSessionId(e.target.value)} />
            <button type="button" style={S.btn} disabled={busy || !scanSessionId} onClick={runScan}>Scan this session</button>
            <button type="button" style={S.btn} disabled={busy} onClick={buildPast}>Build from past sessions</button>
          </div>
          <label style={{ ...S.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={!!data.glossary.players_can_review_suggestions}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await api.patch(`/glossary/${data.glossary.id}/settings`, {
                    players_can_review_suggestions: e.target.checked,
                  });
                  await load();
                } finally { setBusy(false); }
              }}
            />
            Players can accept/dismiss suggestions
          </label>
        </div>
      )}

      {(suggestions.length > 0 || (data.suggested_aliases || []).length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ ...S.h1, fontSize: 11 }}>SUGGESTIONS</div>
          {suggestions.map((e) => (
            <div key={e.id} style={S.card}>
              <strong style={{ color: 'rgba(226,213,187,0.9)' }}>{e.name}</strong>
              <span style={{ marginLeft: 8, color: 'rgba(200,148,58,0.6)', fontSize: 12 }}>{e.type}</span>
              <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.65)', marginTop: 4 }}>{e.description}</div>
              {data.can_review_suggestions && (
                <div style={{ ...S.row, marginTop: 8, marginBottom: 0 }}>
                  <button type="button" style={S.btn} disabled={busy} onClick={async () => { setBusy(true); try { await api.post(`/glossary/entries/${e.id}/accept`); await load(); } finally { setBusy(false); } }}>Accept</button>
                  <button type="button" style={S.btnGhost} disabled={busy} onClick={() => setEditId(e.id)}>Edit</button>
                  <button type="button" style={S.btnGhost} disabled={busy} onClick={async () => { setBusy(true); try { await api.post(`/glossary/entries/${e.id}/dismiss`); await load(); } finally { setBusy(false); } }}>Dismiss</button>
                </div>
              )}
              {editId === e.id && (
                <div style={{ marginTop: 8 }}>
                  <textarea style={{ ...S.input, width: '100%', minHeight: 60 }} value={e.description} onChange={(ev) => {
                    setData((d) => ({
                      ...d,
                      entries: d.entries.map((x) => x.id === e.id ? { ...x, description: ev.target.value } : x),
                    }));
                  }} />
                  <button type="button" style={{ ...S.btn, marginTop: 6 }} disabled={busy} onClick={() => saveEdit({ ...e, status: 'approved' })}>Save & approve</button>
                </div>
              )}
            </div>
          ))}
          {(data.suggested_aliases || []).map((a) => (
            <div key={a.id} style={S.card}>
              Alias <strong>{a.alias}</strong> → {a.entry_name}
              {data.can_review_suggestions && (
                <div style={{ ...S.row, marginTop: 8, marginBottom: 0 }}>
                  <button type="button" style={S.btn} disabled={busy} onClick={async () => { setBusy(true); try { await api.post(`/glossary/aliases/${a.id}/accept`); await load(); } finally { setBusy(false); } }}>Accept</button>
                  <button type="button" style={S.btnGhost} disabled={busy} onClick={async () => { setBusy(true); try { await api.post(`/glossary/aliases/${a.id}/dismiss`); await load(); } finally { setBusy(false); } }}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {TYPES.map((t) => (
        byType[t]?.length ? (
          <div key={t} style={{ marginBottom: 18 }}>
            <div style={{ ...S.h1, fontSize: 11 }}>{t.toUpperCase()}</div>
            {byType[t].map((e) => (
              <div key={e.id} style={S.card}>
                {editId === e.id ? (
                  <>
                    <input style={{ ...S.input, width: '100%', marginBottom: 6 }} value={e.name} onChange={(ev) => {
                      setData((d) => ({ ...d, entries: d.entries.map((x) => x.id === e.id ? { ...x, name: ev.target.value } : x) }));
                    }} />
                    <select style={{ ...S.input, marginBottom: 6 }} value={e.type} onChange={(ev) => {
                      setData((d) => ({ ...d, entries: d.entries.map((x) => x.id === e.id ? { ...x, type: ev.target.value } : x) }));
                    }}>
                      {TYPES.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                    </select>
                    <textarea style={{ ...S.input, width: '100%', minHeight: 50, marginBottom: 6 }} value={e.description} onChange={(ev) => {
                      setData((d) => ({ ...d, entries: d.entries.map((x) => x.id === e.id ? { ...x, description: ev.target.value } : x) }));
                    }} />
                    <input style={{ ...S.input, width: '100%', marginBottom: 6 }} placeholder="Aliases comma-separated" value={(e.aliases || []).map((a) => a.alias || a).join(', ')} onChange={(ev) => {
                      const aliases = ev.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((alias) => ({ alias }));
                      setData((d) => ({ ...d, entries: d.entries.map((x) => x.id === e.id ? { ...x, aliases } : x) }));
                    }} />
                    <button type="button" style={S.btn} disabled={busy} onClick={() => saveEdit(e)}>Save</button>
                    <button type="button" style={{ ...S.btnGhost, marginLeft: 8 }} onClick={() => { setEditId(null); load(); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <strong style={{ color: 'rgba(226,213,187,0.92)' }}>{e.name}</strong>
                    {(e.aliases || []).length > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'rgba(139,196,226,0.55)' }}>
                        also: {(e.aliases || []).map((a) => a.alias || a).join(', ')}
                      </span>
                    )}
                    <div style={{ fontFamily: 'Crimson Pro, serif', color: 'rgba(226,213,187,0.7)', marginTop: 4 }}>{e.description}</div>
                    {data.can_edit && (
                      <div style={{ ...S.row, marginTop: 8, marginBottom: 0 }}>
                        <button type="button" style={S.btnGhost} onClick={() => setEditId(e.id)}>Edit</button>
                        <button type="button" style={S.btnGhost} disabled={busy} onClick={async () => {
                          if (!window.confirm(`Delete ${e.name}?`)) return;
                          setBusy(true);
                          try { await api.delete(`/glossary/entries/${e.id}`); await load(); } finally { setBusy(false); }
                        }}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null
      ))}

      {!filteredApproved.length && (
        <div style={S.muted}>No approved entries yet. Add some, or run a scan on a session.</div>
      )}
    </div>
  );
}
