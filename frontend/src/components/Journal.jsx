import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api.js';
import PromoteModal from './PromoteModal.jsx';
import RecapViewer from './RecapViewer.jsx';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

function parseSQLiteDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  return new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
}

function formatTime(dateStr) {
  return parseSQLiteDate(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr, serverNow) {
  const d   = parseSQLiteDate(dateStr);
  const ref = serverNow ? new Date(serverNow) : new Date();
  const today     = new Date(ref); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dDay      = new Date(d); dDay.setHours(0,0,0,0);
  if (dDay.getTime() === today.getTime())     return 'Today';
  if (dDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Group entries by session_id, sub-divide by date within each session
function groupSessions(sessions, entries, serverNow) {
  return sessions.map((session, idx) => {
    const sessionEntries = entries.filter(e => e.session_id === session.id);
    // Build date parts within this session
    const parts = [];
    let currentDate = null, currentEntries = [];
    sessionEntries.forEach(entry => {
      const day = formatDay(entry.created_at, serverNow);
      if (day !== currentDate) {
        if (currentEntries.length) parts.push({ date: currentDate, entries: currentEntries });
        currentDate = day; currentEntries = [entry];
      } else {
        currentEntries.push(entry);
      }
    });
    if (currentEntries.length) parts.push({ date: currentDate, entries: currentEntries });
    return { session, sessionNum: idx + 1, parts };
  });
}

const INDENT_PX = 24;

export default function Journal({ notes, selectedNoteId, currentUser }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 600;
  const [sessions, setSessions]         = useState([]);
  const [entries, setEntries]           = useState([]);
  const [inputValue, setInputValue]     = useState('');
  const [indentLevel, setIndentLevel]   = useState(0);
  const [insertAfterId, setInsertAfterId] = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editValue, setEditValue]       = useState('');
  const [loading, setLoading]           = useState(true);
  const [promoteEntry, setPromoteEntry] = useState(null);
  const [serverNow, setServerNow]       = useState(null);
  const [movingSession, setMovingSession] = useState(null);
  const [recapSession, setRecapSession]   = useState(null); // { id, num }
  const [aiEnabled, setAiEnabled]         = useState(false);
  const [usageCache, setUsageCache]       = useState({}); // { sessionId: usageObj }
  const inputRef     = useRef(null);
  const bottomRef    = useRef(null);
  const editRef      = useRef(null);
  const scrollAreaRef = useRef(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    api.get('/server-time').then(r => setServerNow(r.data.now)).catch(() => {});
  }, []);

  const rootFolders = notes.filter(n => n.is_folder && !n.parent_id);

  const folderKey = `chronicler_journal_folder_${currentUser?.id || 'anon'}`;
  const [activeFolderId, setActiveFolderIdRaw] = useState(() => {
    try { const s = localStorage.getItem(folderKey); return s ? parseInt(s) : null; } catch { return null; }
  });
  const setActiveFolderId = (id) => {
    setActiveFolderIdRaw(id);
    try { if (id) localStorage.setItem(folderKey, String(id)); else localStorage.removeItem(folderKey); } catch {}
  };

  useEffect(() => {
    if (activeFolderId === null && rootFolders.length > 0) setActiveFolderId(rootFolders[0].id);
  }, [rootFolders.length]);

  const loadEntries = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/journal', { params: activeFolderId ? { folder_id: activeFolderId } : {} });
      const newSessions = res.data.sessions || [];
      setSessions(newSessions);
      // Pre-load usage for all sessions
      if (newSessions.length > 0) {
        const usageResults = await Promise.allSettled(
          newSessions.map(s => api.get(`/recaps/usage/${s.id}`).then(r => ({ id: s.id, data: r.data })))
        );
        const cache = {};
        usageResults.forEach(r => { if (r.status === 'fulfilled') cache[r.value.id] = r.value.data; });
        setUsageCache(cache);
      }
      setEntries(res.data.entries || []);
      // Load AI status
      try {
        const aiRes = await api.get('/admin/ai/status');
        setAiEnabled(aiRes.data.ai_enabled);
      } catch {}
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  }, [activeFolderId]);

  useEffect(() => { loadEntries(false); }, [loadEntries]);

  useEffect(() => {
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data || e.detail);
        if (msg.type === 'journal_changed') loadEntries(true);
        if (msg.type === 'recap_generated' && msg.session_id) {
          // Refresh usage for the affected session
          api.get(`/recaps/usage/${msg.session_id}`).then(r => {
            setUsageCache(prev => ({ ...prev, [msg.session_id]: r.data }));
          }).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('ws_journal', handler);
    return () => window.removeEventListener('ws_journal', handler);
  }, [loadEntries]);

  // Scroll: instant on load/campaign change, smooth on new entry
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || loading) return;
    const newLen = entries.length;
    if (newLen > prevLengthRef.current && prevLengthRef.current > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    prevLengthRef.current = newLen;
  }, [entries, loading]);

  useEffect(() => { prevLengthRef.current = 0; }, [activeFolderId]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editingId]);

  useEffect(() => { inputRef.current?.focus(); }, [insertAfterId]);

  // Current session = last session for this folder
  const currentSessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : null;

  const submitEntry = async (content, indent) => {
    if (!content.trim() || !currentSessionId) return;
    try {
      const res = await api.post('/journal', {
        content,
        indent_level: indent,
        folder_id: activeFolderId,
        session_id: currentSessionId,
        after_id: insertAfterId,
      });
      if (insertAfterId) {
        setEntries(prev => {
          const idx = prev.findIndex(e => e.id === insertAfterId);
          const next = [...prev];
          next.splice(idx + 1, 0, res.data);
          return next;
        });
      } else {
        setEntries(prev => [...prev, res.data]);
      }
      setInputValue('');
      setInsertAfterId(null);
    } catch (err) { console.error(err); }
  };

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await submitEntry(inputValue, indentLevel);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setIndentLevel(prev => e.shiftKey ? Math.max(0, prev - 1) : Math.min(6, prev + 1));
    } else if (e.key === 'Escape') {
      setIndentLevel(0);
      setInsertAfterId(null);
    }
  };

  const handleNewSession = async () => {
    try {
      const res = await api.post('/journal/sessions', { folder_id: activeFolderId });
      setSessions(prev => [...prev, res.data]);
    } catch (err) { console.error(err); }
  };

  const handleContinueSession = async (sessionId) => {
    // Delete session — backend merges its entries into previous
    try {
      await api.delete(`/journal/sessions/${sessionId}`);
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  const handleEditKeyDown = async (e, entry) => {
    if (e.key === 'Enter') { e.preventDefault(); await saveEdit(entry.id); }
    else if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
  };

  const saveEdit = async (id) => {
    const content = editValue.trim();
    if (!content) return;
    try {
      const res = await api.put(`/journal/${id}`, { content });
      setEntries(prev => prev.map(e => e.id === id ? res.data : e));
    } catch (err) { console.error(err); }
    setEditingId(null); setEditValue('');
  };

  const handleChangeIndent = async (entry, delta) => {
    const newLevel = Math.max(0, Math.min(6, (entry.indent_level || 0) + delta));
    try {
      const res = await api.put(`/journal/${entry.id}`, { indent_level: newLevel });
      setEntries(prev => prev.map(e => e.id === entry.id ? res.data : e));
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/journal/${id}`);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) { console.error(err); }
  };

  // Build markdown content from a parent entry + its consecutive child entries
  const buildMarkdownForEntry = (entry) => {
    const isParent = (entry.indent_level || 0) === 0;
    if (!isParent) {
      // Single indented entry: format based on indent
      const prefix = '  '.repeat((entry.indent_level - 1) || 0) + '- ';
      return prefix + entry.content;
    }
    // Parent: grab this entry + consecutive child entries that follow it
    const idx = entries.findIndex(e => e.id === entry.id);
    const lines = [entry.content]; // first line = title/heading
    for (let i = idx + 1; i < entries.length; i++) {
      const e = entries[i];
      if ((e.indent_level || 0) === 0) break; // hit next parent — stop
      const prefix = '  '.repeat((e.indent_level - 1) || 0) + '- ';
      lines.push(prefix + e.content);
    }
    return lines.slice(1).join('\n'); // content = everything after the title line
  };

  const handlePromoteConfirm = async ({ title, category, parent_id, entryId, mode, target_note_id, markdown_content }) => {
    try {
      await api.post(`/journal/${entryId}/promote`, { title, category, parent_id, mode, target_note_id, markdown_content });
      setPromoteEntry(null);
    } catch (err) { console.error(err); }
  };

  const handleMoveSession = async (targetFolderId) => {
    if (!movingSession) return;
    try {
      await api.put(`/journal/sessions/${movingSession.sessionId}/move`, { target_folder_id: targetFolderId });
      setMovingSession(null);
      loadEntries(false);
    } catch (err) { console.error(err); }
  };

  const groups = groupSessions(sessions, entries, serverNow);
  const insertAfterEntry = insertAfterId ? entries.find(e => e.id === insertAfterId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0c14' }}>
      {recapSession && (
        <RecapViewer
          sessionId={recapSession.id}
          sessionNum={recapSession.num}
          currentUser={currentUser}
          aiEnabled={aiEnabled}
          onClose={async () => {
            setRecapSession(null);
            // Refresh usage cache for this session
            try {
              const u = await api.get(`/recaps/usage/${recapSession.id}`);
              setUsageCache(prev => ({ ...prev, [recapSession.id]: u.data }));
            } catch {}
          }}
        />
      )}

      {promoteEntry && (
        <PromoteModal entry={promoteEntry} notes={notes} entries={entries} buildMarkdown={buildMarkdownForEntry} onConfirm={handlePromoteConfirm} onClose={() => setPromoteEntry(null)} />
      )}

      {/* Move session modal */}
      {movingSession && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#0f1219', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '6px', padding: '24px 28px', minWidth: '320px', maxWidth: '420px' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.8)', marginBottom: '6px' }}>MOVE SESSION</div>
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.6)', marginBottom: '18px' }}>
              Move <em>Session {movingSession.sessionNum}</em> to:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
              {rootFolders.filter(f => f.id !== activeFolderId).map(f => (
                <button key={f.id} onClick={() => handleMoveSession(f.id)}
                  style={{ padding: '10px 14px', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.8)', textAlign: 'left' }}>
                  {f.title}
                </button>
              ))}
              {rootFolders.filter(f => f.id !== activeFolderId).length === 0 && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.3)' }}>No other campaigns to move to.</div>
              )}
            </div>
            <button onClick={() => setMovingSession(null)}
              style={{ padding: '6px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.4)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: isMobile ? '12px 16px' : '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? '8px' : '12px', marginBottom: '6px' }}>
          <span style={{ fontFamily: 'Cinzel', fontSize: '12px', letterSpacing: '0.15em', color: '#c8943a' }}>SESSION JOURNAL</span>
          {rootFolders.length > 0 ? (
            <select
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.1em', padding: isMobile ? '8px 10px' : '4px 8px', outline: 'none', cursor: 'pointer', ...(isMobile ? { width: '100%', minHeight: '40px' } : {}) }}
              value={activeFolderId || ''}
              onChange={e => setActiveFolderId(e.target.value ? parseInt(e.target.value) : null)}
            >
              {rootFolders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          ) : (
            <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.3)' }}>Create a root folder to begin</span>
          )}
          <button
            style={{ marginLeft: isMobile ? 0 : 'auto', padding: isMobile ? '10px 16px' : '4px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(226,213,187,0.2)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(226,213,187,0.6)', ...(isMobile ? { alignSelf: 'flex-end', minHeight: '40px' } : {}) }}
            onClick={handleNewSession} title="Start a new session"
            disabled={!activeFolderId}
          >⚔ New Session</button>
        </div>
        {!isMobile && (
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.25)' }}>
            Enter to log · Tab/Shift+Tab to indent · click ⊕ to insert between entries · Esc to reset
          </div>
        )}
      </div>

      {/* Entries */}
      <div ref={scrollAreaRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '0 12px 16px' : '0 24px 16px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Cinzel', color: 'rgba(200,148,58,0.3)', letterSpacing: '0.15em', fontSize: '12px' }}>LOADING...</div>
        ) : !activeFolderId ? (
          <div style={{ padding: '60px 0', textAlign: 'center', fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.2)' }}>Select a campaign above to view its journal</div>
        ) : groups.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '13px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.25)', marginBottom: '8px' }}>NO ENTRIES YET</div>
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.2)' }}>Start typing below and press Enter</div>
          </div>
        ) : (
          groups.map(({ session, sessionNum, parts }) => {
            const isFirst = sessionNum === 1;
            return (
              <div key={session.id} style={{ marginBottom: '4px' }}>
                {/* Session header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 0 4px' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(200,148,58,0.18)' }} />
                  <span style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.25em', color: 'rgba(200,148,58,0.75)' }}>
                    SESSION {sessionNum}
                  </span>
                  {/* Continue Previous Session — merges this session back into the one before */}
                  {!isFirst && (
                    <button
                      onClick={() => handleContinueSession(session.id)}
                      style={{ padding: '2px 8px', background: 'none', border: '1px solid rgba(139,196,58,0.25)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(139,196,58,0.6)' }}
                      title={`Merge back into Session ${sessionNum - 1}`}
                    >↩ Continue Session {sessionNum - 1}</button>
                  )}
                  {rootFolders.length > 1 && (
                    <button
                      onClick={() => setMovingSession({ sessionId: session.id, sessionNum })}
                      style={{ padding: '2px 8px', background: 'none', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.45)' }}
                      title="Move this session to another campaign"
                    >↷ Move</button>
                  )}
                  {(() => {
                    const u = usageCache[session.id];
                    const hasRecaps = u && (u.used > 0 || !u.can_generate);
                    const canGen = aiEnabled && u?.can_generate;
                    const btnColor = canGen ? 'rgba(139,196,226,0.6)' : hasRecaps ? 'rgba(200,148,58,0.5)' : 'rgba(226,213,187,0.2)';
                    const borderColor = canGen ? 'rgba(139,196,226,0.25)' : hasRecaps ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.07)';
                    return (
                      <button
                        onClick={() => setRecapSession({ id: session.id, num: sessionNum })}
                        style={{ padding: '2px 8px', background: 'none', border: `1px solid ${borderColor}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: btnColor }}
                        title={canGen ? 'Generate or view recaps' : hasRecaps ? 'View recaps' : 'Recaps (AI disabled)'}
                      >
                        ✦ {hasRecaps ? `RECAPS${u?.used > 0 ? ` (${u.used})` : ''}` : 'RECAP'}
                      </button>
                    );
                  })()}
                  <div style={{ flex: 1, height: '1px', background: 'rgba(200,148,58,0.18)' }} />
                </div>

                {/* Date parts within session */}
                {parts.map((part, partIdx) => (
                  <div key={part.date || partIdx}>
                    {/* Multi-day session: full date sub-divider */}
                    {parts.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0 6px' }}>
                        <div style={{ width: '32px', height: '1px', background: 'rgba(200,148,58,0.08)' }} />
                        <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(200,148,58,0.5)' }}>{part.date?.toUpperCase()}</span>
                        <div style={{ flex: 1, height: '1px', background: 'rgba(200,148,58,0.08)' }} />
                      </div>
                    )}
                    {/* Single-day: quiet date label below session header */}
                    {parts.length === 1 && (
                      <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.45)', marginBottom: '8px' }}>
                        {part.date?.toUpperCase()}
                      </div>
                    )}
                    {part.entries.map(entry => (
                      <div key={entry.id}>
                        <EntryRow
                          entry={entry}
                          isEditing={editingId === entry.id}
                          editValue={editValue}
                          editRef={editRef}
                          currentUser={currentUser}
                          isInsertTarget={insertAfterId === entry.id}
                          onEdit={() => { setEditingId(entry.id); setEditValue(entry.content); }}
                          onEditChange={setEditValue}
                          onEditKeyDown={(e) => handleEditKeyDown(e, entry)}
                          onEditBlur={() => saveEdit(entry.id)}
                          onDelete={() => handleDelete(entry.id)}
                          onPromote={() => setPromoteEntry(entry)}
                          onInsertAfter={() => setInsertAfterId(insertAfterId === entry.id ? null : entry.id)}
                          onIndentMore={() => handleChangeIndent(entry, 1)}
                          onIndentLess={() => handleChangeIndent(entry, -1)}
                          isMobile={isMobile}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: isMobile ? '10px 16px' : '12px 24px', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
        {insertAfterId && (
          <div style={{ marginBottom: '6px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>↳ INSERTING AFTER: <em style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', letterSpacing: 0, color: 'rgba(226,213,187,0.5)' }}>{insertAfterEntry?.content?.slice(0, 50)}{insertAfterEntry?.content?.length > 50 ? '…' : ''}</em></span>
            <button onClick={() => setInsertAfterId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(224,112,112,0.5)', fontSize: '12px', padding: 0 }}>✕</button>
          </div>
        )}
        {!currentSessionId && activeFolderId && !loading && (
          <div style={{ marginBottom: '8px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.5)' }}>
            No session yet —{' '}
            <button onClick={handleNewSession} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.75)', textDecoration: 'underline', padding: 0 }}>
              start one
            </button>
          </div>
        )}
        {isMobile && activeFolderId && currentSessionId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setIndentLevel(prev => Math.max(0, prev - 1))}
              disabled={indentLevel === 0}
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', color: indentLevel === 0 ? 'rgba(200,148,58,0.2)' : '#c8943a', minWidth: '36px', minHeight: '36px', cursor: indentLevel === 0 ? 'default' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >◀</button>
            <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)', flex: 1, textAlign: 'center' }}>
              {indentLevel === 0 ? 'TOP LEVEL' : `INDENT ${indentLevel}`}
            </span>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setIndentLevel(prev => Math.min(6, prev + 1))}
              disabled={indentLevel >= 6}
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', color: indentLevel >= 6 ? 'rgba(200,148,58,0.2)' : '#c8943a', minWidth: '36px', minHeight: '36px', cursor: indentLevel >= 6 ? 'default' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >▶</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {!isMobile && (
            <span style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)', flexShrink: 0, width: '42px', textAlign: 'right' }}>
              {indentLevel === 0 ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          )}
          {indentLevel > 0 && (
            <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
              {Array.from({ length: indentLevel }).map((_, i) => (
                <span key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(200,148,58,0.4)' }} />
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${insertAfterId ? 'rgba(200,148,58,0.4)' : 'rgba(200,148,58,0.15)'}`, outline: 'none', color: '#e2d5bb', fontFamily: 'Crimson Pro, serif', fontSize: '16px', padding: '6px 0', lineHeight: '1.5', paddingLeft: `${indentLevel * INDENT_PX}px`, minHeight: isMobile ? '44px' : 'auto' }}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={!activeFolderId ? 'Select a campaign above first...' : !currentSessionId ? 'Start a session first...' : insertAfterId ? 'Insert entry here...' : indentLevel === 0 ? 'Log an entry...' : 'Sub-note...'}
            disabled={!activeFolderId || !currentSessionId}
            autoFocus
          />
          {isMobile && inputValue.trim() && (
            <button
              onClick={() => submitEntry(inputValue, indentLevel)}
              style={{ background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '4px', cursor: 'pointer', color: '#c8943a', fontSize: '18px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >↵</button>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryRow({ entry, isEditing, editValue, editRef, currentUser, isInsertTarget, onEdit, onEditChange, onEditKeyDown, onEditBlur, onDelete, onPromote, onInsertAfter, onIndentMore, onIndentLess, isMobile }) {
  const [hovered, setHovered] = useState(false);
  const [mobileShowControls, setMobileShowControls] = useState(false);
  const isIndented = entry.indent_level > 0;
  const isOwner = entry.user_id === currentUser?.id;
  const isAdmin = !!currentUser?.is_admin;
  const canEdit = isOwner || isAdmin;
  const showControls = isMobile ? mobileShowControls : hovered;

  return (
    <div
      style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', gap: isMobile ? '4px' : '12px', padding: `4px 0 4px ${isMobile ? 0 : entry.indent_level * INDENT_PX}px`, paddingLeft: isMobile ? `${entry.indent_level * (INDENT_PX * 0.75)}px` : `${entry.indent_level * INDENT_PX}px`, borderRadius: '3px', background: isInsertTarget ? 'rgba(200,148,58,0.06)' : hovered ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isMobile && (
        <span style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.08em', color: isIndented ? 'rgba(200,148,58,0.3)' : 'rgba(200,148,58,0.65)', flexShrink: 0, marginTop: '3px', width: '42px', textAlign: 'right' }}>
          {isIndented ? '·' : formatTime(entry.created_at)}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <input
            ref={editRef}
            style={{ width: '100%', background: 'rgba(200,148,58,0.05)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '2px', outline: 'none', color: '#e2d5bb', fontFamily: 'Crimson Pro, serif', fontSize: '16px', padding: '2px 6px', lineHeight: '1.6' }}
            value={editValue}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={onEditBlur}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              style={{ fontFamily: 'Crimson Pro, serif', fontSize: '16px', color: isIndented ? 'rgba(226,213,187,0.6)' : '#e2d5bb', lineHeight: '1.6', cursor: canEdit ? (isMobile ? 'pointer' : 'text') : 'default' }}
              onDoubleClick={!isMobile && canEdit ? onEdit : undefined}
              onClick={isMobile ? () => setMobileShowControls(v => !v) : undefined}
            >
              {entry.content}
            </span>
            {entry.author_username && !isMobile && (
              <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: isIndented ? 'rgba(200,148,58,0.3)' : 'rgba(200,148,58,0.55)', flexShrink: 0 }}>
                {entry.author_username}
              </span>
            )}
          </div>
        )}
      </div>

      {showControls && !isEditing && (
        <div style={{ display: 'flex', gap: isMobile ? '6px' : '3px', flexShrink: 0, marginTop: isMobile ? '4px' : '2px', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}), color: isInsertTarget ? 'rgba(200,148,58,0.8)' : 'rgba(200,148,58,0.4)', borderColor: 'rgba(200,148,58,0.2)' }} onClick={onInsertAfter} title="Insert entry after this line">⊕</button>
          {canEdit && <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}) }} onClick={onIndentLess} title="Outdent">←</button>}
          {canEdit && <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}) }} onClick={onIndentMore} title="Indent">→</button>}
          {canEdit && <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}) }} onClick={onEdit}>edit</button>}
          <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}), color: 'rgba(58,196,139,0.5)', borderColor: 'rgba(58,196,139,0.2)' }} onClick={onPromote} title="Convert to note">→ note</button>
          {canEdit && <button style={{ ...smallBtn, ...(isMobile ? mobileBtnExtras : {}), color: 'rgba(224,112,112,0.4)', borderColor: 'rgba(139,32,53,0.2)' }} onClick={onDelete}>×</button>}
          {isMobile && <button style={{ ...smallBtn, ...mobileBtnExtras, color: 'rgba(226,213,187,0.3)' }} onClick={() => setMobileShowControls(false)}>done</button>}
        </div>
      )}
    </div>
  );
}

const smallBtn = {
  background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px',
  cursor: 'pointer', padding: '1px 6px', fontFamily: 'Cinzel', fontSize: '8px',
  letterSpacing: '0.1em', color: 'rgba(226,213,187,0.3)',
};

const mobileBtnExtras = {
  padding: '6px 10px', fontSize: '10px', minHeight: '32px',
};
