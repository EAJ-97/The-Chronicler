import { useState, useEffect, useCallback, useRef } from 'react';
import NoteList from './NoteList.jsx';
import NoteEditor from './NoteEditor.jsx';
import GraphView from './GraphView.jsx';
import AdminPanel from './AdminPanel.jsx';
import Journal from './Journal.jsx';
import TimelineView from './TimelineView.jsx';
import IntegrityPanel from './IntegrityPanel.jsx';
import NotePanel from './NotePanel.jsx';
import ReferencePeekPanel from './ReferencePeekPanel.jsx';
import SnapshotPanel from './SnapshotPanel.jsx';
import TrashPanel from './TrashPanel.jsx';
import CampaignModal from './CampaignModal.jsx';
import api from '../api.js';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

const S = {
  shell: { display: 'flex', flexDirection: 'column', position: 'fixed', inset: 0, overflow: 'hidden', background: '#07080e' },
  topbar: {
    display: 'flex', alignItems: 'center', padding: '0 20px',
    height: '52px', flexShrink: 0,
    background: '#0a0c14', borderBottom: '1px solid rgba(200,148,58,0.12)',
  },
  brand: { fontFamily: 'Cinzel Decorative', fontSize: '15px', fontWeight: '700', color: '#c8943a', letterSpacing: '0.03em', marginRight: '24px' },
  viewToggle: { display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.03)', padding: '3px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.06)' },
  viewBtn: (active) => ({
    padding: '5px 14px', borderRadius: '3px', border: 'none', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em',
    background: active ? 'rgba(200,148,58,0.18)' : 'transparent',
    color: active ? '#c8943a' : 'rgba(226,213,187,0.55)',
    transition: 'all 0.2s',
  }),
  spacer: { flex: 1 },
  userInfo: { display: 'flex', alignItems: 'center', gap: '12px' },
  username: { fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.85)' },
  topBtn: {
    background: 'transparent', border: '1px solid rgba(226,213,187,0.2)',
    borderRadius: '3px', cursor: 'pointer', padding: '4px 10px',
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em',
    color: 'rgba(226,213,187,0.65)', transition: 'all 0.2s',
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  main: { flex: 1, overflow: 'hidden', position: 'relative' },
  // Mobile styles
  mobileHamburger: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'rgba(200,148,58,0.8)', fontSize: '22px',
    minWidth: '44px', minHeight: '44px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
    flexShrink: 0,
    WebkitUserSelect: 'none', userSelect: 'none',
  },
  mobileOverlay: {
    position: 'fixed', inset: 0, zIndex: 500,
    background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
    display: 'flex',
  },
  mobileDrawer: {
    width: '85vw', maxWidth: '320px',
    background: '#0a0c14', borderRight: '1px solid rgba(200,148,58,0.15)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    height: '100%',
  },
  bottomNav: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 400,
    height: 'calc(50px + env(safe-area-inset-bottom))', background: '#0a0c14',
    borderTop: '1px solid rgba(200,148,58,0.15)',
    display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)',
  },
  bottomNavBtn: (active) => ({
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: '4px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: active ? '#c8943a' : 'rgba(226,213,187,0.4)',
    borderTop: active ? '2px solid #c8943a' : '2px solid transparent',
    padding: 0,
    transition: 'color 0.15s, border-top-color 0.15s',
    WebkitUserSelect: 'none', userSelect: 'none',
  }),
  bottomNavIcon: { fontSize: '22px', lineHeight: 1 },
  bottomNavLabel: { fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em' },
  mobileMenuSheet: {
    position: 'fixed', top: 'calc(52px + env(safe-area-inset-top))', left: 0, right: 0, zIndex: 450,
    background: '#0f1219', borderBottom: '1px solid rgba(200,148,58,0.2)',
    borderRadius: '0 0 12px 12px', padding: '16px 16px 8px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  },
  mobileMenuBtn: {
    display: 'flex', alignItems: 'center', gap: '12px',
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer', padding: '12px 4px',
    fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em',
    color: 'rgba(226,213,187,0.7)', textAlign: 'left',
    minHeight: '48px',
  },
};

export default function Dashboard({ user, onLogout }) {
  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth <= 960;
  const isMobile = windowWidth <= 600;

  // Sidebar collapse — default open on wide, collapsed on narrow, persisted
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { const s = localStorage.getItem('chronicler_sidebar_open'); return s === null ? window.innerWidth > 960 : s === 'true'; } catch { return true; }
  });
  const toggleSidebar = () => setSidebarOpen(v => {
    try { localStorage.setItem('chronicler_sidebar_open', String(!v)); } catch {}
    return !v;
  });

  // Mobile-specific state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // PWA install hint — shown on mobile browsers not already in standalone mode
  const [showInstallHint, setShowInstallHint] = useState(() => {
    try {
      if (localStorage.getItem('chronicler_install_dismissed')) return false;
      const isStandalone = window.navigator.standalone === true ||
                           window.matchMedia('(display-mode: standalone)').matches;
      return !isStandalone;
    } catch { return false; }
  });
  const dismissInstallHint = () => {
    try { localStorage.setItem('chronicler_install_dismissed', '1'); } catch {}
    setShowInstallHint(false);
  };

  // Close mobile overlays when switching to desktop
  useEffect(() => {
    if (!isMobile) { setMobileSidebarOpen(false); setMobileMenuOpen(false); }
  }, [isMobile]);

  // VIEW AS popover on narrow topbar
  const [showViewAs, setShowViewAs] = useState(false);
  const viewAsRef = useRef(null);
  // User menu popover on very narrow topbar
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const [notes, setNotes] = useState([]);
  const [dmCampaignIds, setDmCampaignIds] = useState([]);
  const [snapshotFolder, setSnapshotFolder] = useState(null);
  const [connections, setConnections] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [view, setView] = useState('notes');
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [graphPanelNoteId, setGraphPanelNoteId] = useState(null);
  /** Stacked note ids opened from `note:` links in preview (right-hand peek panel). */
  const [refStack, setRefStack] = useState([]);
  const [undoToast, setUndoToast] = useState(null); // { id, title, timer }
  const [simulatedRole, setSimulatedRole] = useState(null); // null=admin, 'dm','owner','granted','hidden'
  const [viewAsUserId, setViewAsUserId] = useState(null); // admin: full visibility as another user (exclusive with simulatedRole)
  const [viewAsUserList, setViewAsUserList] = useState([]);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showIntegrity, setShowIntegrity] = useState(false);
  const [campaignModalOpts, setCampaignModalOpts] = useState({});
  const simulatedRoleRef = useRef(null);
  const viewAsUserIdRef = useRef(null);
  const selectedNoteIdRef = useRef(null);

  // Keep refs in sync so WS handler and loadData always read current values
  useEffect(() => { simulatedRoleRef.current = simulatedRole; }, [simulatedRole]);
  useEffect(() => { viewAsUserIdRef.current = viewAsUserId; }, [viewAsUserId]);
  useEffect(() => { selectedNoteIdRef.current = selectedNoteId; }, [selectedNoteId]);

  /** Closing the peek stack when switching the main editor note avoids stale “layers”. */
  useEffect(() => {
    setRefStack([]);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!user?.is_admin) return;
    api.get('/notes/meta/users').then((r) => setViewAsUserList(r.data || [])).catch(() => {});
  }, [user?.is_admin]);
  const allRootFolderIds = notes.filter(n => n.is_folder && !n.parent_id).map(n => n.id);
  const effectiveDmCampaignIds = simulatedRole === 'dm' ? allRootFolderIds
    : simulatedRole ? []
    : dmCampaignIds;

  /**
   * Reloads notes, connections (edges whose endpoints are both visible), and DM campaign ids.
   * Admin: optional as_user (full user view) takes precedence over role simulate; connections are clipped to visible notes.
   */
  const loadData = useCallback(async () => {
    try {
      const simRole = simulatedRoleRef.current;
      const asUid = viewAsUserIdRef.current;
      const params = {};
      if (user?.is_admin && asUid) params.as_user = asUid;
      else if (simRole) params.simulate = simRole;
      const dmOpts = user?.is_admin && asUid ? { params: { as_user: asUid } } : {};
      const [notesRes, connsRes, dmRes] = await Promise.all([
        api.get('/notes', Object.keys(params).length ? { params } : {}),
        api.get('/connections'),
        api.get('/notes/meta/my-dm-campaigns', Object.keys(dmOpts).length ? dmOpts : {}),
      ]);
      // Preserve locally-cached content when updated_at hasn't changed.
      // Without this, every WS-triggered loadData (including from the saving user's own
      // auto-save) wipes content from all notes, causing blank-on-save, delayed B-user
      // updates, and stale content after tab switches.
      // If updated_at *did* change (another user edited), content is intentionally cleared
      // so the selectedNoteHasContent effect below re-fetches the fresh version.
      // Also: if the currently selected note is absent from the server response (e.g. a
      // transient visibility race), keep the previous state entry so selectedNote never
      // becomes null — that would fire the [note?.id] effect and blank the editor.
      setNotes((prev) => {
        const mapped = notesRes.data.map((n) => {
          const existing = prev.find((p) => p.id === n.id);
          if (existing?.content !== undefined && existing.updated_at === n.updated_at) {
            return { ...n, content: existing.content };
          }
          return n;
        });
        const currentId = selectedNoteIdRef.current;
        if (currentId && !mapped.find((n) => n.id === currentId)) {
          const preserved = prev.find((p) => p.id === currentId);
          if (preserved) return [...mapped, preserved];
        }
        return mapped;
      });
      const visibleIds = new Set((notesRes.data || []).map((n) => n.id));
      setConnections((connsRes.data || []).filter(
        (c) => visibleIds.has(c.source_note_id) && visibleIds.has(c.target_note_id)
      ));
      setDmCampaignIds(dmRes.data || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.is_admin]);

  // Initial load and whenever simulation / impersonation / loader deps change
  useEffect(() => {
    setSelectedNoteId(null);
    loadData();
  }, [simulatedRole, viewAsUserId, loadData]);

  // Live updates via WebSocket — reload data whenever another user changes something
  const wsRef = useRef(null);
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/ws?token=${token}`;
    let reconnectTimer = null;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        loadData();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'notes_changed' || msg.type === 'connections_changed') {
            loadData();
          }
          if (msg.type === 'journal_changed') {
            window.dispatchEvent(new CustomEvent('ws_journal', { detail: e.data }));
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [loadData]);

  // Refresh data when app returns to foreground (critical for PWA standalone mode)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadData();
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          wsRef.current?.close();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadData]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;

  // Fetch full note content on demand — the list endpoint omits content for performance.
  // Also re-fetches when content is wiped (e.g. WS-triggered loadData refreshes the list).
  // Treat null the same as undefined — both mean "content not yet loaded".
  const selectedNoteHasContent = selectedNote?.content != null;
  useEffect(() => {
    if (!selectedNoteId || !selectedNote || selectedNoteHasContent) return;
    api.get(`/notes/${selectedNoteId}`).then((r) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selectedNoteId
            ? {
                ...n,
                ...r.data,
                source_deleted:
                  r.data.source_deleted !== undefined ? r.data.source_deleted : n.source_deleted,
              }
            : n
        )
      );
    }).catch(() => {});
  }, [selectedNoteId, selectedNoteHasContent]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Pushes a note id onto the reference peek stack and loads full note content via GET /notes/:id when needed.
   * Merges the response into `notes` so the panel and list stay consistent.
   */
  const openReferenceNote = useCallback(async (id) => {
    const numId = Number(id);
    if (!Number.isFinite(numId)) return;
    setRefStack((prev) => {
      if (prev.length && prev[prev.length - 1] === numId) return prev;
      return [...prev, numId];
    });
    try {
      const r = await api.get(`/notes/${numId}`);
      setNotes((prev) => {
        const ix = prev.findIndex((n) => n.id === numId);
        if (ix >= 0) {
          const merged = {
            ...prev[ix],
            ...r.data,
            source_deleted:
              r.data.source_deleted !== undefined ? r.data.source_deleted : prev[ix].source_deleted,
          };
          const next = [...prev];
          next[ix] = merged;
          return next;
        }
        return [...prev, r.data];
      });
    } catch (e) {
      console.error(e);
      setRefStack((prev) => (prev.length && prev[prev.length - 1] === numId ? prev.slice(0, -1) : prev));
    }
  }, []);

  const handleCreateNote = async (parentId = null) => {
    if (parentId === null && selectedNoteId) {
      const sel = notes.find((n) => n.id === selectedNoteId);
      if (sel) parentId = sel.is_folder ? sel.id : (sel.parent_id || null);
    }
    try {
      const res = await api.post('/notes', { title: 'New Note', content: '', category: 'general', is_shared: false, parent_id: parentId });
      await loadData();
      setSelectedNoteId(res.data.id);
      setView('notes');
    } catch (err) { console.error(err); }
  };

  const handleCreateFolder = async (parentId = null) => {
    if (parentId === null && selectedNoteId) {
      const sel = notes.find((n) => n.id === selectedNoteId);
      if (sel) parentId = sel.is_folder ? sel.id : (sel.parent_id || null);
    }
    try {
      await api.post('/notes', { title: 'New Folder', content: '', is_folder: true, is_shared: false, parent_id: parentId });
      await loadData();
    } catch (err) { console.error(err); }
  };

  const handleCreateCampaign = async ({ title, members, is_world, parent_id }) => {
    try {
      await api.post('/notes', {
        title,
        content: '',
        is_folder: true,
        is_shared: false,
        parent_id: parent_id ?? null,
        members,
        is_world: !!is_world,
      });
      await loadData();
      setShowCampaignModal(false);
    } catch (err) { console.error(err); }
  };

  const handleSaveNote = async (updates) => {
    if (!updates) { await loadData(); return; }
    if (!selectedNoteId) return;
    if (updates.id) {
      setNotes(prev => prev.map(n => n.id === updates.id ? { ...n, ...updates } : n));
      return;
    }
    // Patch object — do the PUT here (tags, visibility, permissions, etc.)
    try {
      const res = await api.put(`/notes/${selectedNoteId}`, updates);
      if (updates.tags !== undefined || updates.visibility !== undefined || updates.granted_users !== undefined) {
        await loadData();
      } else {
        setNotes(prev => prev.map(n => n.id === selectedNoteId ? res.data : n));
      }
    } catch (err) { console.error(err); }
  };

  const handleMoveNote = async (noteId, newParentId) => {
    try {
      if (newParentId) {
        const target = notes.find(n => n.id === newParentId);
        if (target && target.visibility === 'hidden' && target.user_id !== user.id && !user.is_admin) {
          const ok = window.confirm(
            `"${target.title}" is private and owned by ${target.author || 'another user'}.\n\nIf you move this here, you may lose access to it. Continue?`
          );
          if (!ok) return;
        }
      }
      await api.put(`/notes/${noteId}`, { parent_id: newParentId ?? null });
      await loadData();
    } catch (err) { console.error(err); }
  };

  const handleRenameNote = async (noteId, newTitle) => {
    try {
      const res = await api.put(`/notes/${noteId}`, { title: newTitle });
      setNotes(prev => prev.map(n => n.id === noteId ? res.data : n));
    } catch (err) { console.error(err); }
  };

  const handleDeleteNote = async (noteId, title, isFolder) => {
    const msg = isFolder
      ? `Delete folder "${title}" and everything inside it?`
      : `Delete note "${title}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/notes/${noteId}`);
      setNotes(prev => prev.filter(n => n.id !== noteId && n.parent_id !== noteId));
      if (selectedNoteId === noteId) setSelectedNoteId(null);
      // Show undo toast for 6 seconds
      if (undoToast?.timer) clearTimeout(undoToast.timer);
      const timer = setTimeout(() => setUndoToast(null), 6000);
      setUndoToast({ id: noteId, title, is_folder: isFolder, timer });
      await loadData();
    } catch (err) { console.error(err); }
  };

  const handleUndoDelete = async () => {
    if (!undoToast) return;
    clearTimeout(undoToast.timer);
    setUndoToast(null);
    try {
      await api.post(`/notes/${undoToast.id}/restore`);
      await loadData();
    } catch (err) { console.error(err); }
  };

  /**
   * Creates a graph edge. Optional `opts.connection_kind` is `canon` | `theory` | `ship` (theory/ship are web gimmick modes).
   * @param {number} sourceId
   * @param {number} targetId
   * @param {{ connection_kind?: string }} [opts]
   */
  const handleCreateConnection = async (sourceId, targetId, opts = {}) => {
    try {
      const body = { source_note_id: sourceId, target_note_id: targetId };
      if (opts.connection_kind) body.connection_kind = opts.connection_kind;
      const res = await api.post('/connections', body);
      setConnections(prev => [...prev, res.data]);
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg) window.alert(msg);
      console.error(err);
    }
  };

  /**
   * Deletes a connection by id (used from graph to remove theory/ship links). Returns false if the user cancels confirm.
   * @param {number} connId
   * @returns {Promise<boolean|void>}
   */
  const handleDeleteConnection = async (connId) => {
    if (!window.confirm('Remove this theory or ship link?')) return false;
    try {
      await api.delete(`/connections/${connId}`);
      await loadData();
      return true;
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg) window.alert(msg);
      console.error(err);
      throw err;
    }
  };

  /**
   * Triggers a browser download from a blob response (Content-Disposition filename used when present).
   * @param {Blob} blob
   * @param {string} [fallbackName]
   */
  const triggerBlobDownload = (blob, fallbackName) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackName || 'download';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Shared NoteList props (used both in desktop sidebar and mobile drawer)
  const noteListProps = {
    notes,
    selectedId: selectedNoteId,
    onSelect: (id) => {
      const n = notes.find((row) => row.id === id);
      setSelectedNoteId(id);
      if (!n?.is_folder && view !== 'graph') setView('notes');
      if (isMobile) setMobileSidebarOpen(false);
    },
    onDeselect: () => setSelectedNoteId(null),
    onCreateNote: handleCreateNote,
    onCreateFolder: handleCreateFolder,
    onOpenCampaignModal: (opts) => {
      setCampaignModalOpts(opts || {});
      setShowCampaignModal(true);
    },
    onDelete: handleDeleteNote,
    onRename: handleRenameNote,
    onMove: handleMoveNote,
    onSnapshot: (folderId) => setSnapshotFolder(notes.find(n => n.id === folderId)),
    onExport: async (folderId, folderTitle) => {
      try {
        const parseFilename = (disp, fb) => {
          const m = String(disp || '').match(/filename="?([^";]+)"?/i);
          return m ? m[1].trim() : fb;
        };
        const readError = async (blob) => {
          try {
            const t = await blob.text();
            const j = JSON.parse(t);
            return j.error || 'Export failed';
          } catch {
            return 'Export failed';
          }
        };

        const resJson = await api.get(`/backup/export/${folderId}`, { responseType: 'blob', validateStatus: () => true });
        if (resJson.status !== 200 || !String(resJson.headers['content-disposition'] || '').includes('attachment')) {
          const msg =
            resJson.status === 403
              ? 'You are not allowed to export this folder'
              : await readError(resJson.data);
          window.alert(msg);
          return;
        }
        triggerBlobDownload(
          resJson.data,
          parseFilename(resJson.headers['content-disposition'], `chronicler-export-${folderId}.json`)
        );

        await new Promise((r) => setTimeout(r, 300));

        const resHtml = await api.get(`/backup/export/${folderId}/html`, { responseType: 'blob', validateStatus: () => true });
        if (resHtml.status !== 200 || !String(resHtml.headers['content-disposition'] || '').includes('attachment')) {
          const msg = await readError(resHtml.data);
          window.alert(
            `JSON downloaded, but the HTML viewer could not be generated: ${msg}\n\nYou can still use the JSON file for admin import.`
          );
          return;
        }
        triggerBlobDownload(
          resHtml.data,
          parseFilename(resHtml.headers['content-disposition'], `chronicler-viewer-${folderId}.html`)
        );
      } catch (e) {
        window.alert(e.message || 'Export failed');
      }
    },
    onSync: async (folderId, folderTitle) => {
      if (!window.confirm(`Sync visibility of "${folderTitle}" to all its children?\nThis will override child note permissions to match the folder.`)) return;
      try {
        await api.post(`/notes/${folderId}/sync-visibility`);
        await loadData();
      } catch (err) { console.error('Sync failed', err); }
    },
    currentUser: user,
    dmCampaignIds: effectiveDmCampaignIds,
    simulatedRole,
    isMobile,
  };

  if (loading) {
    return (
      <div style={{ ...S.shell, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'Cinzel', color: '#c8943a', letterSpacing: '0.2em', fontSize: '13px' }}>LOADING CHRONICLES...</div>
      </div>
    );
  }

  return (
    <div style={S.shell}>
      {showAdmin && <AdminPanel currentUser={user} onClose={() => setShowAdmin(false)} onChroniclerImportDone={loadData} />}
      {showTrash && <TrashPanel currentUser={user} onClose={() => setShowTrash(false)} onRestored={() => loadData()} />}

      {/* Undo toast */}
      {undoToast && (
        <div style={{ position: 'fixed', bottom: isMobile ? '72px' : '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: '#1a1c26', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '5px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'rgba(226,213,187,0.6)' }}>"{undoToast.title}" moved to trash</span>
          <button onClick={handleUndoDelete} style={{ background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '3px', cursor: 'pointer', padding: '3px 10px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em' }}>
            UNDO
          </button>
          <button onClick={() => { clearTimeout(undoToast.timer); setUndoToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.3)', fontSize: '14px', padding: 0 }}>×</button>
        </div>
      )}

      {/* Default password warning banner */}
      {user.force_password_change ? (
        <div style={{ background: 'rgba(196,80,58,0.18)', borderBottom: '1px solid rgba(196,80,58,0.4)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, zIndex: 20 }}>
          <span style={{ fontSize: '14px' }}>⚠</span>
          <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(226,160,100,0.9)', flex: 1 }}>
            DEFAULT PASSWORD IN USE — Change your password in Admin → Password before sharing this server
          </span>
          <button
            onClick={() => setShowAdmin(true)}
            style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', padding: '4px 12px', background: 'rgba(196,80,58,0.25)', border: '1px solid rgba(196,80,58,0.5)', borderRadius: '3px', cursor: 'pointer', color: 'rgba(226,160,100,0.9)' }}
          >
            CHANGE NOW
          </button>
        </div>
      ) : null}

      {/* ── TOPBAR ── */}
      {isMobile ? (
        /* Mobile topbar: hamburger | brand | ··· */
        <div style={{ ...S.topbar, height: 'calc(52px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}>
          <button style={S.mobileHamburger} onClick={() => setMobileSidebarOpen(true)} aria-label="Open notes">
            ☰
          </button>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <span style={{ ...S.brand, marginRight: 0, fontSize: '13px' }}>The Chronicler</span>
          </div>
          <div style={{ minWidth: '44px' }} />
        </div>
      ) : (
        /* Desktop topbar: unchanged */
        <div style={S.topbar}>
          <span style={S.brand}>The Chronicler</span>
          <div style={S.viewToggle}>
            <button style={S.viewBtn(view === 'notes')} onClick={() => setView('notes')}>📜 Notes</button>
            <button style={S.viewBtn(view === 'graph')} onClick={() => setView('graph')}>🕸 Web</button>
            <button style={S.viewBtn(view === 'journal')} onClick={() => setView('journal')}>⚡ Journal</button>
            <button style={S.viewBtn(view === 'timeline')} onClick={() => setView('timeline')}>⏱ Timeline</button>
          </div>
          {(effectiveDmCampaignIds.length > 0 || user.is_admin) && (
            <button
              type="button"
              style={{ ...S.topBtn, marginLeft: '10px' }}
              onClick={() => setShowIntegrity(true)}
              title="Scan campaign folder for data issues"
            >
              Integrity
            </button>
          )}
          {!!user.is_admin && (
            isNarrow ? (
              <div style={{ position: 'relative', marginLeft: '10px' }} ref={viewAsRef}>
                <button
                  onClick={() => setShowViewAs(v => !v)}
                  style={{
                    ...S.topBtn,
                    color: (viewAsUserId || simulatedRole) ? '#c8943a' : 'rgba(226,213,187,0.65)',
                    borderColor: (viewAsUserId || simulatedRole) ? 'rgba(200,148,58,0.4)' : 'rgba(226,213,187,0.2)',
                  }}
                  title="View As"
                >⚙ {viewAsUserId
                  ? (viewAsUserList.find((u) => u.id === viewAsUserId)?.username || 'user').toUpperCase().slice(0, 10)
                  : simulatedRole ? simulatedRole.toUpperCase() : 'VIEW'}</button>
                {showViewAs && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 100, background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '160px', boxShadow: '0 6px 24px rgba(0,0,0,0.6)' }}>
                    <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.35)', padding: '2px 6px 4px' }}>VIEW AS ROLE</div>
                    {[
                      { role: null,      label: 'ADMIN' },
                      { role: 'dm',      label: 'DM' },
                      { role: 'owner',   label: 'OWNER' },
                      { role: 'granted', label: 'GRANTED' },
                      { role: 'hidden',  label: 'HIDDEN' },
                    ].map(({ role, label }) => (
                      <button key={label} onClick={() => { setViewAsUserId(null); setSimulatedRole(role); setShowViewAs(false); }} style={{ padding: '5px 10px', borderRadius: '3px', border: '1px solid', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', background: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.2)' : 'transparent', borderColor: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.08)', color: !viewAsUserId && simulatedRole === role ? '#c8943a' : 'rgba(226,213,187,0.5)', transition: 'all 0.15s', textAlign: 'left' }}>{label}</button>
                    ))}
                    {viewAsUserList.length > 0 && (
                      <>
                        <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.35)', padding: '6px 6px 2px' }}>AS USER</div>
                        <select
                          value={viewAsUserId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSimulatedRole(null);
                            setViewAsUserId(v ? parseInt(v, 10) : null);
                            setShowViewAs(false);
                          }}
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '8px', padding: '5px 6px', cursor: 'pointer' }}
                        >
                          <option value="">— Off —</option>
                          {viewAsUserList.map((u) => (
                            <option key={u.id} value={u.id}>{u.username}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', marginLeft: '16px', maxWidth: '42vw' }}>
                <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.35)', marginRight: '2px' }}>VIEW AS</span>
                {[
                  { role: null,      label: 'ADMIN' },
                  { role: 'dm',      label: 'DM' },
                  { role: 'owner',   label: 'OWNER' },
                  { role: 'granted', label: 'GRANTED' },
                  { role: 'hidden',  label: 'HIDDEN' },
                ].map(({ role, label }) => (
                  <button key={label} onClick={() => { setViewAsUserId(null); setSimulatedRole(role); }} style={{ padding: '3px 8px', borderRadius: '3px', border: '1px solid', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', background: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.2)' : 'transparent', borderColor: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.08)', color: !viewAsUserId && simulatedRole === role ? '#c8943a' : 'rgba(226,213,187,0.3)', transition: 'all 0.15s' }}>{label}</button>
                ))}
                {viewAsUserList.length > 0 && (
                  <select
                    value={viewAsUserId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSimulatedRole(null);
                      setViewAsUserId(v ? parseInt(v, 10) : null);
                    }}
                    title="View dashboard as this user"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '8px', padding: '3px 6px', cursor: 'pointer', maxWidth: '120px' }}
                  >
                    <option value="">User: off</option>
                    {viewAsUserList.map((u) => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          )}
          <div style={S.spacer} />
          <div style={S.userInfo}>
            {!isNarrow && <span style={S.username}>{user.username.toUpperCase()}</span>}
            {windowWidth <= 720 ? (
              <div style={{ position: 'relative' }} ref={userMenuRef}>
                <button
                  style={{ ...S.topBtn, letterSpacing: '0.2em', fontSize: '12px', padding: '4px 10px' }}
                  onClick={() => setShowUserMenu(v => !v)}
                  title="Menu"
                >···</button>
                {showUserMenu && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 100, background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '130px', boxShadow: '0 6px 24px rgba(0,0,0,0.6)' }}>
                    <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.4)', padding: '2px 6px 4px' }}>{user.username.toUpperCase()}</div>
                    <button style={{ ...S.topBtn, textAlign: 'left', width: '100%' }} onClick={() => { setShowTrash(true); setShowUserMenu(false); }}>🗑 Trash</button>
                    {!!user.is_admin && <button style={{ ...S.topBtn, textAlign: 'left', width: '100%', color: 'rgba(200,148,58,0.85)', borderColor: 'rgba(200,148,58,0.4)' }} onClick={() => { setShowAdmin(true); setShowUserMenu(false); }}>Admin</button>}
                    <button style={{ ...S.topBtn, textAlign: 'left', width: '100%' }} onClick={onLogout}>Leave</button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button style={S.topBtn} onClick={() => setShowTrash(true)} title="View deleted items">🗑</button>
                {!!user.is_admin && <button style={{ ...S.topBtn, color: 'rgba(200,148,58,0.85)', borderColor: 'rgba(200,148,58,0.4)' }} onClick={() => setShowAdmin(true)}>Admin</button>}
                <button style={S.topBtn} onClick={onLogout}>Leave</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MOBILE SIDEBAR DRAWER OVERLAY ── */}
      {isMobile && (
        <div
          style={{ ...S.mobileOverlay, opacity: mobileSidebarOpen ? 1 : 0, pointerEvents: mobileSidebarOpen ? 'auto' : 'none', transition: 'opacity 0.22s ease' }}
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            style={{ ...S.mobileDrawer, transform: mobileSidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid rgba(200,148,58,0.08)', flexShrink: 0 }}>
              <button style={{ ...S.mobileHamburger, fontSize: '20px', color: 'rgba(226,213,187,0.4)' }} onClick={() => setMobileSidebarOpen(false)} aria-label="Close">×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <NoteList
                {...noteListProps}
                collapsed={false}
                onToggleCollapse={() => {}}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE MENU SHEET ── */}
      {isMobile && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 440, opacity: mobileMenuOpen ? 1 : 0, pointerEvents: mobileMenuOpen ? 'auto' : 'none', transition: 'opacity 0.2s ease' }} onClick={() => setMobileMenuOpen(false)} />
          <div style={{ ...S.mobileMenuSheet, opacity: mobileMenuOpen ? 1 : 0, transform: mobileMenuOpen ? 'translateY(0)' : 'translateY(-8px)', transition: 'opacity 0.2s ease, transform 0.2s ease', pointerEvents: mobileMenuOpen ? 'auto' : 'none' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(200,148,58,0.5)', marginBottom: '8px' }}>
              {user.username.toUpperCase()}
            </div>
            {!!user.is_admin && (
              <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(200,148,58,0.12)' }}>
                <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.35)', marginBottom: '4px' }}>VIEW AS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    { role: null, label: 'ADMIN' },
                    { role: 'dm', label: 'DM' },
                    { role: 'owner', label: 'OWNER' },
                    { role: 'granted', label: 'GRANTED' },
                    { role: 'hidden', label: 'HIDDEN' },
                  ].map(({ role, label }) => (
                    <button key={label} onClick={() => { setViewAsUserId(null); setSimulatedRole(role); setMobileMenuOpen(false); }} style={{ padding: '6px 10px', borderRadius: '3px', border: '1px solid', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', background: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.2)' : 'transparent', borderColor: !viewAsUserId && simulatedRole === role ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.08)', color: !viewAsUserId && simulatedRole === role ? '#c8943a' : 'rgba(226,213,187,0.5)' }}>{label}</button>
                  ))}
                </div>
                {viewAsUserList.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.35)', marginBottom: '4px' }}>AS USER</div>
                    <select
                      value={viewAsUserId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSimulatedRole(null);
                        setViewAsUserId(v ? parseInt(v, 10) : null);
                        setMobileMenuOpen(false);
                      }}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '9px', padding: '8px 6px' }}
                    >
                      <option value="">— Off —</option>
                      {viewAsUserList.map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            <button style={S.mobileMenuBtn} onClick={() => { setShowTrash(true); setMobileMenuOpen(false); }}>
              <span>🗑</span> Trash
            </button>
            {(effectiveDmCampaignIds.length > 0 || user.is_admin) && (
              <button style={S.mobileMenuBtn} onClick={() => { setShowIntegrity(true); setMobileMenuOpen(false); }}>
                <span>⚙</span> Integrity scan
              </button>
            )}
            {!!user.is_admin && (
              <button style={{ ...S.mobileMenuBtn, color: 'rgba(200,148,58,0.85)' }} onClick={() => { setShowAdmin(true); setMobileMenuOpen(false); }}>
                <span>⚙</span> Admin
              </button>
            )}
            <button style={{ ...S.mobileMenuBtn, borderBottom: 'none' }} onClick={onLogout}>
              <span>↩</span> Leave
            </button>
          </div>
        </>
      )}

      {/* ── PWA INSTALL HINT ── */}
      {isMobile && showInstallHint && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 14px', background: 'rgba(200,148,58,0.06)', borderBottom: '1px solid rgba(200,148,58,0.12)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>📲</span>
          <span style={{ fontFamily: 'Cinzel', fontSize: '7.5px', letterSpacing: '0.08em', color: 'rgba(200,148,58,0.65)', flex: 1, lineHeight: '1.5' }}>
            {/iphone|ipad|ipod/i.test(navigator.userAgent)
              ? 'INSTALL AS APP — tap Share ⬆ then "Add to Home Screen"'
              : 'INSTALL AS APP — tap ⋮ then "Add to Home Screen"'}
          </span>
          <button onClick={dismissInstallHint} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(200,148,58,0.35)', fontSize: '20px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── BODY ── */}
      <div style={{ ...S.body, paddingBottom: isMobile ? 'calc(50px + env(safe-area-inset-bottom))' : 0 }}>
        {/* Desktop sidebar — hidden on mobile (mobile uses drawer overlay) */}
        {!isMobile && view !== 'journal' && (
          <NoteList
            {...noteListProps}
            collapsed={!sidebarOpen}
            onToggleCollapse={toggleSidebar}
          />
        )}

        {/* Snapshot modal */}
        {snapshotFolder && (
          <SnapshotPanel
            folder={snapshotFolder}
            worldLayerTitle={(() => {
              const pid = snapshotFolder.parent_id;
              if (pid == null) return null;
              const p = notes.find((n) => n.id === pid);
              return p?.is_world ? (p.title || '').trim() || 'World' : null;
            })()}
            currentUser={user}
            dmCampaignIds={effectiveDmCampaignIds}
            onClose={() => setSnapshotFolder(null)}
            onRestored={() => loadData()}
          />
        )}

        {/* Campaign creation modal */}
        {showIntegrity && (
          <IntegrityPanel
            onClose={() => setShowIntegrity(false)}
            notes={notes}
            currentUser={user}
            dmCampaignIds={effectiveDmCampaignIds}
          />
        )}

        {showCampaignModal && (
          <CampaignModal
            key={`${campaignModalOpts.initialCreationType ?? ''}-${campaignModalOpts.underWorldId ?? ''}`}
            currentUser={user}
            initialCreationType={campaignModalOpts.initialCreationType}
            underWorldId={campaignModalOpts.underWorldId}
            onConfirm={handleCreateCampaign}
            onClose={() => { setShowCampaignModal(false); setCampaignModalOpts({}); }}
          />
        )}

        <div style={S.main}>
          {view === 'notes' && (
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                position: 'relative',
                flexDirection: 'row',
              }}
            >
              <div
                style={{
                  flex: !isMobile && refStack.length > 0 ? '1 1 50%' : '1 1 100%',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'flex-basis 0.32s ease',
                }}
              >
                <NoteEditor
                  note={selectedNote}
                  notes={notes}
                  connections={connections}
                  currentUser={user}
                  dmCampaignIds={effectiveDmCampaignIds}
                  simulatedRole={simulatedRole}
                  onSave={handleSaveNote}
                  onDelete={handleDeleteNote}
                  isMobile={isMobile}
                  onBackToList={() => setMobileSidebarOpen(true)}
                  onOpenReferenceNote={openReferenceNote}
                  onSelectNote={(id) => {
                    setSelectedNoteId(id);
                    loadData();
                  }}
                />
              </div>
              {refStack.length > 0 && (
                <ReferencePeekPanel
                  stack={refStack}
                  notes={notes}
                  onBack={() => setRefStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
                  onClose={() => setRefStack([])}
                  onOpenReference={openReferenceNote}
                  isMobile={isMobile}
                />
              )}
            </div>
          )}

          {view === 'graph' && (
            <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
              {/* Desktop: side panel. Mobile: bottom sheet handled below */}
              {!isMobile && (
                <div style={{
                  width: graphPanelNoteId ? '300px' : '0px',
                  flexShrink: 0,
                  overflow: 'hidden',
                  transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
                }}>
                  {graphPanelNoteId && (
                    <NotePanel
                      note={notes.find(n => n.id === graphPanelNoteId)}
                      notes={notes}
                      connections={connections}
                      onClose={() => setGraphPanelNoteId(null)}
                    />
                  )}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <GraphView
                  allNotes={notes}
                  notes={notes.filter(n => !n.is_folder)}
                  connections={connections}
                  onSelectNote={(id) => { setSelectedNoteId(id); setGraphPanelNoteId(id); }}
                  onOpenNote={(id) => { setSelectedNoteId(id); setGraphPanelNoteId(null); setView('notes'); }}
                  onCreateConnection={handleCreateConnection}
                  onDeleteConnection={handleDeleteConnection}
                  onUpdateConnection={() => loadData()}
                  selectedNoteId={selectedNoteId}
                  currentUser={user}
                  dmCampaignIds={effectiveDmCampaignIds}
                  simulatedRole={simulatedRole}
                  isMobile={isMobile}
                />
              </div>
              {/* Mobile graph note panel — bottom sheet */}
              {isMobile && graphPanelNoteId && (
                <div style={{
                  position: 'fixed', bottom: '56px', left: 0, right: 0,
                  height: '45vh', zIndex: 300,
                  background: '#0a0c14',
                  borderTop: '1px solid rgba(200,148,58,0.2)',
                  overflow: 'hidden',
                }}>
                  <NotePanel
                    note={notes.find(n => n.id === graphPanelNoteId)}
                    notes={notes}
                    connections={connections}
                    onClose={() => setGraphPanelNoteId(null)}
                  />
                </div>
              )}
            </div>
          )}

          {view === 'journal' && (
            <Journal notes={notes} selectedNoteId={selectedNoteId} currentUser={user} dmCampaignIds={effectiveDmCampaignIds} />
          )}

          {view === 'timeline' && (
            <TimelineView notes={notes} currentUser={user} />
          )}
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAVIGATION BAR ── */}
      {isMobile && (
        <div style={S.bottomNav}>
          <button style={S.bottomNavBtn(view === 'notes')} onClick={() => setView('notes')}>
            <span style={S.bottomNavIcon}>📜</span>
            <span style={S.bottomNavLabel}>NOTES</span>
          </button>
          <button style={S.bottomNavBtn(view === 'graph')} onClick={() => setView('graph')}>
            <span style={S.bottomNavIcon}>🕸</span>
            <span style={S.bottomNavLabel}>WEB</span>
          </button>
          <button style={S.bottomNavBtn(view === 'journal')} onClick={() => setView('journal')}>
            <span style={S.bottomNavIcon}>⚡</span>
            <span style={S.bottomNavLabel}>JOURNAL</span>
          </button>
          <button style={S.bottomNavBtn(view === 'timeline')} onClick={() => setView('timeline')}>
            <span style={S.bottomNavIcon}>⏱</span>
            <span style={S.bottomNavLabel}>TIME</span>
          </button>
          <button style={S.bottomNavBtn(mobileMenuOpen)} onClick={() => setMobileMenuOpen(v => !v)}>
            <span style={S.bottomNavIcon}>☰</span>
            <span style={S.bottomNavLabel}>MENU</span>
          </button>
        </div>
      )}
    </div>
  );
}
