import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../api.js';
import PromoteModal from './PromoteModal.jsx';
import RecapViewer from './RecapViewer.jsx';
import { useWindowWidth } from '../hooks/useWindowWidth.js';
import { getGraphCampaignRoots, isUnderCompletedArchive } from '../utils/campaignTree.js';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';

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

export default function Journal({ notes, selectedNoteId, currentUser, dmCampaignIds = [] }) {
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
  /** DM-only prep checklist modal: which session is being edited. */
  const [prepSession, setPrepSession]       = useState(null); // { id, num } | null
  /** Session attendance modal (read all; write DM/admin). */
  const [attendanceSession, setAttendanceSession] = useState(null); // { id, num } | null
  const [aiEnabled, setAiEnabled]         = useState(false);
  const [recapServerReady, setRecapServerReady] = useState(false);
  const [usageCache, setUsageCache]       = useState({}); // { sessionId: usageObj }
  /** Lore So Far panel: cached markdown per user+campaign (server) + UI state. */
  const [lorePanelOpen, setLorePanelOpen] = useState(false);
  const [loreText, setLoreText]           = useState('');
  const [loreUpdatedAt, setLoreUpdatedAt] = useState(null);
  const [loreLoading, setLoreLoading]     = useState(false);
  const [loreBusy, setLoreBusy]           = useState(false);
  const [loreErr, setLoreErr]             = useState('');
  /** DM-only prep checklist rows from GET /journal `session_checklists` (string session id keys). */
  const [sessionChecklists, setSessionChecklists] = useState({});
  /** Per-session party attendance from GET /journal `session_attendance` (string session id keys). */
  const [sessionAttendance, setSessionAttendance] = useState({});
  /** Draft text for "add checklist item" per session id. */
  const [prepDrafts, setPrepDrafts]       = useState({});
  const inputRef     = useRef(null);
  const bottomRef    = useRef(null);
  const editRef      = useRef(null);
  const scrollAreaRef = useRef(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    api.get('/server-time').then(r => setServerNow(r.data.now)).catch(() => {});
  }, []);

  const journalCampaignRoots = useMemo(() => getGraphCampaignRoots(notes), [notes]);

  const folderKey = `chronicler_journal_folder_${currentUser?.id || 'anon'}`;
  const [activeFolderId, setActiveFolderIdRaw] = useState(() => {
    try { const s = localStorage.getItem(folderKey); return s ? parseInt(s) : null; } catch { return null; }
  });
  const setActiveFolderId = (id) => {
    setActiveFolderIdRaw(id);
    try { if (id) localStorage.setItem(folderKey, String(id)); else localStorage.removeItem(folderKey); } catch {}
  };

  /** True when the user may view/edit DM prep checklists for the selected journal campaign. */
  const canPrepForJournal = useMemo(() => {
    if (!activeFolderId) return false;
    if (currentUser?.is_admin) return true;
    return (dmCampaignIds || []).includes(activeFolderId);
  }, [activeFolderId, currentUser?.is_admin, dmCampaignIds]);

  /**
   * Folder row for the selected journal campaign — used to re-sync archive state when notes list updates (e.g. completion toggled).
   */
  const activeJournalFolderRow = useMemo(
    () => (activeFolderId != null ? (notes || []).find((n) => Number(n.id) === Number(activeFolderId)) : null),
    [notes, activeFolderId],
  );

  /** GET /notes/:id `under_completed_archive` (DB walk); null until loaded. */
  const [journalArchiveFromServer, setJournalArchiveFromServer] = useState(null);

  useEffect(() => {
    if (!activeFolderId) {
      setJournalArchiveFromServer(null);
      return;
    }
    let cancelled = false;
    setJournalArchiveFromServer(null);
    api
      .get(`/notes/${activeFolderId}`)
      .then((r) => {
        if (!cancelled) setJournalArchiveFromServer(!!r.data?.under_completed_archive);
      })
      .catch(() => {
        if (!cancelled) setJournalArchiveFromServer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFolderId, activeJournalFolderRow?.updated_at, activeJournalFolderRow?.is_completed]);

  /** Client walk (strict is_completed) while server flag is unknown; then prefer server result. */
  const journalLockedClient = activeFolderId != null && isUnderCompletedArchive(notes, activeFolderId);
  const journalLocked =
    activeFolderId != null &&
    !currentUser?.is_admin &&
    (journalArchiveFromServer !== null ? journalArchiveFromServer : journalLockedClient);

  /** localStorage key: whether the Lore So Far panel is open for this user + campaign. */
  const loreOpenKey = useMemo(() => {
    if (!currentUser?.id || !activeFolderId) return null;
    return `chronicler_lore_panel_open_${currentUser.id}_${activeFolderId}`;
  }, [currentUser?.id, activeFolderId]);

  /** Restore open/closed Lore panel preference when the active campaign changes. */
  useEffect(() => {
    if (!loreOpenKey) {
      setLorePanelOpen(false);
      return;
    }
    try {
      setLorePanelOpen(localStorage.getItem(loreOpenKey) === '1');
    } catch {
      setLorePanelOpen(false);
    }
  }, [loreOpenKey]);

  /**
   * Persists Lore panel visibility and updates React state.
   * @param {boolean} open - Next open state.
   */
  const persistLorePanelOpen = useCallback((open) => {
    setLorePanelOpen(open);
    if (!loreOpenKey) return;
    try {
      localStorage.setItem(loreOpenKey, open ? '1' : '0');
    } catch { /* ignore quota */ }
  }, [loreOpenKey]);

  /** When the panel is open, load cached lore from GET /api/ai/lore/:campaignId. */
  useEffect(() => {
    if (!lorePanelOpen || !activeFolderId) return;
    let cancelled = false;
    setLoreLoading(true);
    setLoreErr('');
    api.get(`/ai/lore/${activeFolderId}`)
      .then((r) => {
        if (!cancelled) {
          setLoreText(r.data.content || '');
          setLoreUpdatedAt(r.data.updated_at || null);
        }
      })
      .catch((e) => {
        if (!cancelled) setLoreErr(e.response?.data?.error || e.message || 'Failed to load lore');
      })
      .finally(() => {
        if (!cancelled) setLoreLoading(false);
      });
    return () => { cancelled = true; };
  }, [lorePanelOpen, activeFolderId]);

  /**
   * Calls POST /api/ai/lore/:id/generate (does not persist unless user clicks Save).
   */
  const handleLoreGenerate = async () => {
    if (journalLocked) return;
    if (!activeFolderId) return;
    if (!aiEnabled) {
      setLoreErr('AI is disabled in Admin settings.');
      return;
    }
    setLoreBusy(true);
    setLoreErr('');
    try {
      const r = await api.post(`/ai/lore/${activeFolderId}/generate`, { save: false });
      setLoreText(r.data.content || '');
      setLoreUpdatedAt(r.data.updated_at || null);
    } catch (e) {
      setLoreErr(e.response?.data?.error || e.message || 'Generation failed');
    } finally {
      setLoreBusy(false);
    }
  };

  /** Persists current lore text with PUT /api/ai/lore/:id. */
  const handleLoreSave = async () => {
    if (journalLocked) return;
    if (!activeFolderId) return;
    setLoreBusy(true);
    setLoreErr('');
    try {
      const r = await api.put(`/ai/lore/${activeFolderId}`, { content: loreText });
      setLoreUpdatedAt(r.data.updated_at || null);
    } catch (e) {
      setLoreErr(e.response?.data?.error || e.message || 'Save failed');
    } finally {
      setLoreBusy(false);
    }
  };

  useEffect(() => {
    if (journalCampaignRoots.length === 0) return;
    const ids = new Set(journalCampaignRoots.map((f) => f.id));
    if (activeFolderId == null || !ids.has(activeFolderId)) {
      setActiveFolderId(journalCampaignRoots[0].id);
    }
  }, [journalCampaignRoots, activeFolderId]);

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
      setSessionChecklists(res.data.session_checklists && typeof res.data.session_checklists === 'object' ? res.data.session_checklists : {});
      setSessionAttendance(res.data.session_attendance && typeof res.data.session_attendance === 'object' ? res.data.session_attendance : {});
      // Load AI status
      try {
        const aiRes = await api.get('/admin/ai/status');
        setAiEnabled(!!aiRes.data.ai_enabled);
        setRecapServerReady(!!aiRes.data.recap_generation_ready);
      } catch {}
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  }, [activeFolderId]);

  useEffect(() => { loadEntries(false); }, [loadEntries]);

  /** Close prep modal if its session is no longer in the loaded journal (e.g. campaign switch). */
  useEffect(() => {
    if (!prepSession) return;
    if (!sessions.some((s) => s.id === prepSession.id)) setPrepSession(null);
  }, [sessions, prepSession]);

  /** Close attendance modal if its session is no longer loaded. */
  useEffect(() => {
    if (!attendanceSession) return;
    if (!sessions.some((s) => s.id === attendanceSession.id)) setAttendanceSession(null);
  }, [sessions, attendanceSession]);

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
    if (journalLocked) return;
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
    if (journalLocked) return;
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
    if (journalLocked) return;
    try {
      const res = await api.post('/journal/sessions', { folder_id: activeFolderId });
      setSessions(prev => [...prev, res.data]);
    } catch (err) { console.error(err); }
  };

  const handleContinueSession = async (sessionId) => {
    if (journalLocked) return;
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
    if (journalLocked) return;
    const content = editValue.trim();
    if (!content) return;
    try {
      const res = await api.put(`/journal/${id}`, { content });
      setEntries(prev => prev.map(e => e.id === id ? res.data : e));
    } catch (err) { console.error(err); }
    setEditingId(null); setEditValue('');
  };

  const handleChangeIndent = async (entry, delta) => {
    if (journalLocked) return;
    const newLevel = Math.max(0, Math.min(6, (entry.indent_level || 0) + delta));
    try {
      const res = await api.put(`/journal/${entry.id}`, { indent_level: newLevel });
      setEntries(prev => prev.map(e => e.id === entry.id ? res.data : e));
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id) => {
    if (journalLocked) return;
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
    if (journalLocked) return;
    try {
      await api.post(`/journal/${entryId}/promote`, { title, category, parent_id, mode, target_note_id, markdown_content });
      setPromoteEntry(null);
    } catch (err) { console.error(err); }
  };

  const handleMoveSession = async (targetFolderId) => {
    if (journalLocked) return;
    if (!movingSession) return;
    try {
      await api.put(`/journal/sessions/${movingSession.sessionId}/move`, { target_folder_id: targetFolderId });
      setMovingSession(null);
      loadEntries(false);
    } catch (err) { console.error(err); }
  };

  /**
   * Adds a prep checklist line via POST /journal/sessions/:id/checklist-items; clears draft and reloads journal payload.
   * @param {number} sessionId
   */
  const handlePrepAdd = async (sessionId) => {
    if (journalLocked) return;
    const draft = (prepDrafts[sessionId] || '').trim();
    if (!draft) return;
    try {
      await api.post(`/journal/sessions/${sessionId}/checklist-items`, { content: draft });
      setPrepDrafts((prev) => ({ ...prev, [sessionId]: '' }));
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  /**
   * Flips is_checked for one checklist row (DM/admin).
   * @param {{ id: number, is_checked?: number }} item
   */
  const handlePrepToggleChecked = async (item) => {
    if (journalLocked) return;
    try {
      await api.put(`/journal/checklist-items/${item.id}`, { is_checked: !item.is_checked });
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  /**
   * Deletes one prep checklist row.
   * @param {number} itemId
   */
  const handlePrepDelete = async (itemId) => {
    if (journalLocked) return;
    try {
      await api.delete(`/journal/checklist-items/${itemId}`);
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  /**
   * Unchecks all items for a session (prep reset between games).
   * @param {number} sessionId
   */
  const handlePrepResetChecks = async (sessionId) => {
    if (journalLocked) return;
    try {
      await api.post(`/journal/sessions/${sessionId}/checklist-items/reset-checks`);
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  /**
   * Sets attendance for one campaign member (DM/admin). Reloads journal payload.
   * @param {number} sessionId
   * @param {number} userId
   * @param {boolean} attended
   */
  const handleAttendanceSet = async (sessionId, userId, attended) => {
    if (journalLocked) return;
    try {
      await api.put(`/journal/sessions/${sessionId}/attendance`, { user_id: userId, attended });
      loadEntries(true);
    } catch (err) { console.error(err); }
  };

  const groups = groupSessions(sessions, entries, serverNow);
  const insertAfterEntry = insertAfterId ? entries.find(e => e.id === insertAfterId) : null;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0c14' }}>
      {journalLocked && (
        <div
          style={{
            flexShrink: 0,
            padding: '8px 16px',
            borderBottom: '1px solid rgba(200,148,58,0.2)',
            background: 'rgba(200,148,58,0.07)',
            fontFamily: 'Crimson Pro, serif',
            fontSize: '13px',
            color: 'rgba(226,213,187,0.85)',
            lineHeight: 1.45,
          }}
        >
          This campaign is marked <strong style={{ color: '#c8943a' }}>completed</strong>. The journal is read-only. A DM can clear completion on the campaign or world root folder.
        </div>
      )}
      {recapSession && (
        <RecapViewer
          sessionId={recapSession.id}
          sessionNum={recapSession.num}
          aiEnabled={aiEnabled}
          recapServerReady={recapServerReady}
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
              {journalCampaignRoots.filter(f => f.id !== activeFolderId).map(f => (
                <button key={f.id} onClick={() => handleMoveSession(f.id)}
                  style={{ padding: '10px 14px', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.8)', textAlign: 'left' }}>
                  {f.title}
                </button>
              ))}
              {journalCampaignRoots.filter(f => f.id !== activeFolderId).length === 0 && (
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

      {/* Prep checklist modal (DM/admin) */}
      {prepSession && canPrepForJournal && (
        <div
          role="dialog"
          aria-labelledby="prep-checklist-title"
          style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPrepSession(null); }}
        >
          <div style={{ background: '#0f1219', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '6px', padding: '22px 26px', width: 'min(440px, calc(100vw - 32px))', maxHeight: 'min(70vh, 520px)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
              <div>
                <div id="prep-checklist-title" style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.8)', marginBottom: '4px' }}>PREP CHECKLIST</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)' }}>
                  Session {prepSession.num}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPrepSession(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.35)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '0 4px' }}
                aria-label="Close prep checklist"
              >
                ×
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, marginBottom: '14px' }}>
              {(sessionChecklists[String(prepSession.id)] || []).map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!item.is_checked}
                    onChange={() => handlePrepToggleChecked(item)}
                    style={{ marginTop: '4px', accentColor: '#c8943a', cursor: 'pointer', flexShrink: 0 }}
                    aria-label="Toggle prep item done"
                  />
                  <span
                    style={{
                      flex: 1, fontFamily: 'Crimson Pro, serif', fontSize: '14px', lineHeight: 1.45,
                      color: item.is_checked ? 'rgba(226,213,187,0.35)' : 'rgba(226,213,187,0.88)',
                      textDecoration: item.is_checked ? 'line-through' : 'none', wordBreak: 'break-word',
                    }}
                  >
                    {item.content}
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePrepDelete(item.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(224,112,112,0.45)',
                      fontSize: '16px', padding: '0 6px', flexShrink: 0,
                    }}
                    title="Remove item"
                  >
                    ×
                  </button>
                </div>
              ))}
              {(sessionChecklists[String(prepSession.id)] || []).length === 0 && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.25)', padding: '8px 0' }}>
                  No items yet — add tasks below.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={prepDrafts[prepSession.id] || ''}
                onChange={(e) => setPrepDrafts((prev) => ({ ...prev, [prepSession.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handlePrepAdd(prepSession.id); } }}
                placeholder="Add prep item…"
                maxLength={500}
                style={{
                  flex: '1 1 160px', minWidth: 0, padding: '10px 12px', fontFamily: 'Crimson Pro, serif', fontSize: '14px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                  color: 'rgba(226,213,187,0.9)', outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => handlePrepAdd(prepSession.id)}
                style={{
                  padding: '10px 16px', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                  background: 'rgba(200,148,58,0.12)', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '4px',
                  cursor: 'pointer', color: '#c8943a',
                }}
              >
                ADD
              </button>
              {(sessionChecklists[String(prepSession.id)] || []).some((i) => i.is_checked) && (
                <button
                  type="button"
                  onClick={() => handlePrepResetChecks(prepSession.id)}
                  style={{
                    padding: '10px 14px', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px',
                    cursor: 'pointer', color: 'rgba(226,213,187,0.5)',
                  }}
                >
                  UNCHECK ALL
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Session attendance (read all party; DM/admin sets marks) */}
      {attendanceSession && (
        <div
          role="dialog"
          aria-labelledby="session-attendance-title"
          style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setAttendanceSession(null); }}
        >
          <div style={{ background: '#0f1219', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '6px', padding: '22px 26px', width: 'min(400px, calc(100vw - 32px))', maxHeight: 'min(70vh, 480px)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
              <div>
                <div id="session-attendance-title" style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.8)', marginBottom: '4px' }}>SESSION ATTENDANCE</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)' }}>
                  Session {attendanceSession.num}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttendanceSession(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(226,213,187,0.35)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '0 4px' }}
                aria-label="Close attendance"
              >
                ×
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {(sessionAttendance[String(attendanceSession.id)] || []).length === 0 ? (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.28)', padding: '8px 0' }}>
                  No party members on this campaign yet (add members via note permissions or DM roles).
                </div>
              ) : (
                (sessionAttendance[String(attendanceSession.id)] || []).map((row) => (
                  <div
                    key={row.user_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                      padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div style={{ flex: '1 1 120px', minWidth: 0 }}>
                      <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.9)' }}>{row.username}</span>
                      {!!row.is_dm && (
                        <span style={{ marginLeft: '8px', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.45)' }}>DM</span>
                      )}
                    </div>
                    {canPrepForJournal ? (
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleAttendanceSet(attendanceSession.id, row.user_id, true)}
                          style={{
                            padding: '4px 10px', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em',
                            background: row.attended === true ? 'rgba(58,196,139,0.15)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${row.attended === true ? 'rgba(58,196,139,0.35)' : 'rgba(255,255,255,0.1)'}`,
                            borderRadius: '3px', cursor: 'pointer', color: row.attended === true ? 'rgba(58,196,139,0.85)' : 'rgba(226,213,187,0.35)',
                          }}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAttendanceSet(attendanceSession.id, row.user_id, false)}
                          style={{
                            padding: '4px 10px', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em',
                            background: row.attended === false ? 'rgba(224,112,112,0.12)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${row.attended === false ? 'rgba(224,112,112,0.35)' : 'rgba(255,255,255,0.1)'}`,
                            borderRadius: '3px', cursor: 'pointer', color: row.attended === false ? 'rgba(224,112,112,0.8)' : 'rgba(226,213,187,0.35)',
                          }}
                        >
                          Absent
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.4)' }}>
                        {row.attended === true ? 'Present' : row.attended === false ? 'Absent' : '—'}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
            {!canPrepForJournal && (sessionAttendance[String(attendanceSession.id)] || []).length > 0 && (
              <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.25)', marginTop: '12px' }}>
                Only the DM can change attendance.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: isMobile ? '12px 16px' : '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: isMobile ? '10px' : '8px', marginBottom: '6px' }}>
          <span style={{ fontFamily: 'Cinzel', fontSize: '12px', letterSpacing: '0.15em', color: '#c8943a' }}>SESSION JOURNAL</span>
          {journalCampaignRoots.length > 0 ? (
            <select
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.1em', padding: isMobile ? '8px 10px' : '4px 8px', outline: 'none', cursor: 'pointer', ...(isMobile ? { width: '100%', minHeight: '40px' } : {}) }}
              value={activeFolderId || ''}
              onChange={e => setActiveFolderId(e.target.value ? parseInt(e.target.value) : null)}
            >
              {journalCampaignRoots.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          ) : (
            <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.3)' }}>Create a root folder to begin</span>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'nowrap' }}>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '10px 12px',
                minHeight: '40px',
                background: lorePanelOpen ? 'rgba(139,196,226,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${lorePanelOpen ? 'rgba(139,196,226,0.35)' : 'rgba(226,213,187,0.2)'}`,
                borderRadius: '3px',
                cursor: activeFolderId ? 'pointer' : 'not-allowed',
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.12em',
                color: lorePanelOpen ? 'rgba(139,196,226,0.85)' : 'rgba(226,213,187,0.6)',
              }}
              onClick={() => persistLorePanelOpen(!lorePanelOpen)}
              title="AI summary of visible campaign notes + journal (per-user cache)"
              disabled={!activeFolderId}
            >
              📜 Lore So Far
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '10px 12px',
                minHeight: '40px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(226,213,187,0.2)',
                borderRadius: '3px',
                cursor: !activeFolderId || journalLocked ? 'not-allowed' : 'pointer',
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.12em',
                color: !activeFolderId || journalLocked ? 'rgba(226,213,187,0.25)' : 'rgba(226,213,187,0.6)',
              }}
              onClick={handleNewSession}
              title={journalLocked ? 'Journal is read-only while this campaign is marked completed' : 'Start a new session'}
              disabled={!activeFolderId || journalLocked}
            >
              ⚔ New Session
            </button>
          </div>
        </div>
        {!isMobile && (
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.25)' }}>
            Enter to log · Tab/Shift+Tab to indent · click ⊕ to insert between entries · Esc to reset
          </div>
        )}
      </div>

      {/* Lore So Far — visibility-safe AI summary; per-user cache on server */}
      {lorePanelOpen && activeFolderId && (
        <div style={{
          flexShrink: 0,
          maxHeight: 'min(42vh, 480px)',
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid rgba(139,196,226,0.15)',
          background: 'linear-gradient(180deg, rgba(139,196,226,0.06) 0%, rgba(7,8,14,0.4) 100%)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
            padding: isMobile ? '10px 14px' : '10px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.18em', color: 'rgba(139,196,226,0.85)' }}>LORE SO FAR</span>
            {loreUpdatedAt && (
              <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.35)' }}>
                Saved {parseSQLiteDate(loreUpdatedAt).toLocaleString()}
              </span>
            )}
            <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={loreBusy || !aiEnabled}
                onClick={handleLoreGenerate}
                style={{
                  padding: '5px 12px', borderRadius: '3px', cursor: loreBusy || !aiEnabled ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                  border: `1px solid ${!aiEnabled ? 'rgba(226,213,187,0.1)' : 'rgba(139,196,226,0.35)'}`,
                  background: !aiEnabled ? 'transparent' : 'rgba(139,196,226,0.12)',
                  color: !aiEnabled ? 'rgba(226,213,187,0.25)' : 'rgba(139,196,226,0.9)',
                }}
                title={!aiEnabled ? 'Enable AI in Admin' : 'Regenerate from visible notes + journal'}
              >{loreBusy ? '…' : 'Generate / Refresh'}</button>
              <button
                type="button"
                disabled={loreBusy}
                onClick={handleLoreSave}
                style={{
                  padding: '5px 12px', borderRadius: '3px', cursor: loreBusy ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                  border: '1px solid rgba(200,148,58,0.35)', background: 'rgba(200,148,58,0.1)', color: '#c8943a',
                }}
                title="Save current text as your cached lore for this campaign"
              >Save</button>
              <button
                type="button"
                onClick={() => persistLorePanelOpen(false)}
                style={{
                  padding: '5px 12px', borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(226,213,187,0.45)',
                }}
              >Close</button>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '12px 14px 16px' : '14px 24px 18px' }}>
            {loreLoading ? (
              <div style={{ fontFamily: 'Cinzel', fontSize: '11px', color: 'rgba(139,196,226,0.45)', letterSpacing: '0.12em' }}>Loading saved lore…</div>
            ) : loreErr ? (
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(224,112,112,0.85)' }}>{loreErr}</div>
            ) : (
              <>
                {!aiEnabled && (
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.4)', marginBottom: '10px' }}>
                    AI is disabled — enable it in Admin → AI to generate lore.
                  </div>
                )}
                <textarea
                  value={loreText}
                  onChange={(e) => setLoreText(e.target.value)}
                  placeholder="Click Generate / Refresh to build lore from notes and journal entries you can see, or type here and Save."
                  style={{
                    width: '100%', minHeight: '120px', boxSizing: 'border-box', resize: 'vertical',
                    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(139,196,226,0.15)', borderRadius: '4px',
                    color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', lineHeight: 1.6,
                    padding: '12px 14px', marginBottom: '14px', outline: 'none',
                  }}
                />
                <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(139,196,226,0.45)', marginBottom: '8px' }}>PREVIEW</div>
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', lineHeight: 1.65, color: '#e2d5bb' }}>
                  {loreText.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={chroniclerUrlTransform}>
                      {loreText}
                    </ReactMarkdown>
                  ) : (
                    <span style={{ color: 'rgba(226,213,187,0.35)' }}>No lore yet.</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
                {/* Session header — label + actions centered between equal flex lines (stable when Continue is hidden) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 0 4px', width: '100%' }}>
                  <div style={{ flex: 1, minWidth: 0, height: '1px', background: 'rgba(200,148,58,0.18)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.25em', color: 'rgba(200,148,58,0.75)' }}>
                      SESSION {sessionNum}
                    </span>
                    {!isFirst && (
                      <button
                        type="button"
                        onClick={() => handleContinueSession(session.id)}
                        disabled={journalLocked}
                        style={{
                          padding: '2px 8px',
                          background: 'none',
                          border: '1px solid rgba(139,196,58,0.25)',
                          borderRadius: '3px',
                          cursor: journalLocked ? 'not-allowed' : 'pointer',
                          fontFamily: 'Cinzel',
                          fontSize: '8px',
                          letterSpacing: '0.1em',
                          color: journalLocked ? 'rgba(139,196,58,0.2)' : 'rgba(139,196,58,0.6)',
                        }}
                        title={journalLocked ? 'Journal is read-only' : `Merge back into Session ${sessionNum - 1}`}
                      >
                        ↩ Continue Session {sessionNum - 1}
                      </button>
                    )}
                    {journalCampaignRoots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setMovingSession({ sessionId: session.id, sessionNum })}
                        disabled={journalLocked}
                        style={{
                          padding: '2px 8px',
                          background: 'none',
                          border: '1px solid rgba(200,148,58,0.2)',
                          borderRadius: '3px',
                          cursor: journalLocked ? 'not-allowed' : 'pointer',
                          fontFamily: 'Cinzel',
                          fontSize: '8px',
                          letterSpacing: '0.1em',
                          color: journalLocked ? 'rgba(200,148,58,0.15)' : 'rgba(200,148,58,0.45)',
                        }}
                        title={journalLocked ? 'Journal is read-only' : 'Move this session to another campaign'}
                      >
                        ↷ Move
                      </button>
                    )}
                    {canPrepForJournal && (() => {
                      const prepItems = sessionChecklists[String(session.id)] || [];
                      const done = prepItems.filter((i) => i.is_checked).length;
                      const total = prepItems.length;
                      const prepTitle = total ? `Prep checklist: ${done}/${total} done` : 'DM prep checklist for this session';
                      return (
                        <button
                          type="button"
                          onClick={() => setPrepSession({ id: session.id, num: sessionNum })}
                          style={{ padding: '2px 8px', background: 'none', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)' }}
                          title={prepTitle}
                        >
                          ✓ Prep{total ? ` ${done}/${total}` : ''}
                        </button>
                      );
                    })()}
                    {(() => {
                      const attRows = sessionAttendance[String(session.id)] || [];
                      const presentCount = attRows.filter((r) => r.attended === true).length;
                      const attTitle = attRows.length
                        ? `Who attended session ${sessionNum} — ${presentCount} present of ${attRows.length}`
                        : 'Party attendance for this session';
                      return (
                        <button
                          type="button"
                          onClick={() => setAttendanceSession({ id: session.id, num: sessionNum })}
                          style={{ padding: '2px 8px', background: 'none', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.48)' }}
                          title={attTitle}
                        >
                          👥 Roll{attRows.length ? ` ${presentCount}/${attRows.length}` : ''}
                        </button>
                      );
                    })()}
                    {(() => {
                      const u = usageCache[session.id];
                      const hasRecaps = u && (u.used > 0 || !u.can_generate);
                      const canGen = aiEnabled && u?.can_generate;
                      const btnColor = canGen ? 'rgba(139,196,226,0.6)' : hasRecaps ? 'rgba(200,148,58,0.5)' : 'rgba(226,213,187,0.2)';
                      const borderColor = canGen ? 'rgba(139,196,226,0.25)' : hasRecaps ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.07)';
                      return (
                        <button
                          type="button"
                          onClick={() => setRecapSession({ id: session.id, num: sessionNum })}
                          style={{ padding: '2px 8px', background: 'none', border: `1px solid ${borderColor}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: btnColor }}
                          title={canGen ? 'Generate or view recaps' : hasRecaps ? 'View recaps' : 'Recaps (AI disabled)'}
                        >
                          ✦ {hasRecaps ? `RECAPS${u?.used > 0 ? ` (${u.used})` : ''}` : 'RECAP'}
                        </button>
                      );
                    })()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, height: '1px', background: 'rgba(200,148,58,0.18)' }} />
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
                          journalLocked={journalLocked}
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
            <button
              type="button"
              onClick={handleNewSession}
              disabled={journalLocked}
              style={{
                background: 'none',
                border: 'none',
                cursor: journalLocked ? 'not-allowed' : 'pointer',
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.12em',
                color: journalLocked ? 'rgba(200,148,58,0.25)' : 'rgba(200,148,58,0.75)',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              start one
            </button>
          </div>
        )}
        {isMobile && activeFolderId && currentSessionId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setIndentLevel(prev => Math.max(0, prev - 1))}
              disabled={journalLocked || indentLevel === 0}
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', color: journalLocked || indentLevel === 0 ? 'rgba(200,148,58,0.2)' : '#c8943a', minWidth: '36px', minHeight: '36px', cursor: journalLocked || indentLevel === 0 ? 'default' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >◀</button>
            <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.5)', flex: 1, textAlign: 'center' }}>
              {indentLevel === 0 ? 'TOP LEVEL' : `INDENT ${indentLevel}`}
            </span>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setIndentLevel(prev => Math.min(6, prev + 1))}
              disabled={journalLocked || indentLevel >= 6}
              style={{ background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', color: journalLocked || indentLevel >= 6 ? 'rgba(200,148,58,0.2)' : '#c8943a', minWidth: '36px', minHeight: '36px', cursor: journalLocked || indentLevel >= 6 ? 'default' : 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
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
            disabled={!activeFolderId || !currentSessionId || journalLocked}
            autoFocus
          />
          {isMobile && inputValue.trim() && (
            <button
              type="button"
              onClick={() => submitEntry(inputValue, indentLevel)}
              disabled={journalLocked || !activeFolderId || !currentSessionId}
              style={{
                background: 'rgba(200,148,58,0.15)',
                border: '1px solid rgba(200,148,58,0.4)',
                borderRadius: '4px',
                cursor: journalLocked || !currentSessionId ? 'not-allowed' : 'pointer',
                color: journalLocked || !currentSessionId ? 'rgba(200,148,58,0.25)' : '#c8943a',
                fontSize: '18px',
                minWidth: '44px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >↵</button>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryRow({ entry, isEditing, editValue, editRef, currentUser, journalLocked = false, isInsertTarget, onEdit, onEditChange, onEditKeyDown, onEditBlur, onDelete, onPromote, onInsertAfter, onIndentMore, onIndentLess, isMobile }) {
  const [hovered, setHovered] = useState(false);
  const [mobileShowControls, setMobileShowControls] = useState(false);
  const isIndented = entry.indent_level > 0;
  const isOwner = entry.user_id === currentUser?.id;
  const isAdmin = !!currentUser?.is_admin;
  const canEdit = (isOwner || isAdmin) && !journalLocked;
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
