import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';
import api from '../api.js';
import MoveModal from './MoveModal.jsx';
import {
  notesByIdMap,
  getCampaignFolderIdForSelection,
  isCompletionScopeRootNote,
  isUnderCompletedArchive,
} from '../utils/campaignTree.js';
import {
  getFolderTreeKind,
  iconChoicesForFolderKind,
  NOTE_ICON_CATEGORIES,
  allUniqueNotePresetIcons,
  defaultNoteIconEmoji,
  isManagedSidebarIconUrl,
} from '../utils/displayIcons.js';

/**
 * If the cursor is in an active @mention segment on the current line, returns the query text (may
 * include spaces for multi-word titles) and the range to replace from `@` through the cursor.
 * @param {string} text - Full editor value
 * @param {number} cursorPos - caret index
 * @returns {{ query: string, replaceStart: number, replaceEnd: number } | null}
 */
function parseMentionAtCursor(text, cursorPos) {
  const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
  const line = text.slice(lineStart, cursorPos);
  const atRel = line.lastIndexOf('@');
  if (atRel === -1) return null;
  if (atRel > 0 && !/[\s([{@]/.test(line[atRel - 1])) return null;
  const query = line.slice(atRel + 1);
  return {
    query,
    replaceStart: lineStart + atRel,
    replaceEnd: cursorPos,
  };
}

const CATEGORIES = [
  { value: 'npc',      label: 'NPC / Character', color: '#c47f3a' },
  { value: 'location', label: 'Location',         color: '#3a8fc4' },
  { value: 'faction',  label: 'Faction / Org',    color: '#8b2035' },
  { value: 'item',     label: 'Item / Artifact',   color: '#6b3ac4' },
  { value: 'event',    label: 'Quest / Event',     color: '#3ac48b' },
  { value: 'lore',     label: 'Lore / History',    color: '#9a8535' },
  { value: 'general',  label: 'General',           color: '#4a5568' },
];

export function getCategoryColor(cat) {
  return CATEGORIES.find(c => c.value === cat)?.color || '#4a5568';
}

/**
 * Viewport-fixed box for a dropdown anchored above an input, used with createPortal(document.body)
 * so lists are not clipped by drawer overflow or covered by the editor.
 * @param {HTMLElement | null} inputEl - Anchor element (e.g. connection search input).
 * @param {number} [minWidth=200] - Minimum dropdown width (tags use a smaller field).
 * @returns {{ left: number, width: number, bottom: number, maxHeight: number } | null}
 */
function getFixedDropdownAboveInput(inputEl, minWidth = 200) {
  if (!inputEl || typeof inputEl.getBoundingClientRect !== 'function') return null;
  const rect = inputEl.getBoundingClientRect();
  const w = Math.max(minWidth, rect.width);
  const left = Math.min(rect.left, Math.max(8, window.innerWidth - w - 8));
  const maxH = Math.max(80, Math.min(240, rect.top - 8));
  return {
    left,
    width: w,
    bottom: window.innerHeight - rect.top + 4,
    maxHeight: maxH,
  };
}

/**
 * Expanded bottom drawer height. Prefer vh-only clamp (not min(dvh,vh,px)) so the panel does not
 * collapse when dvh shrinks with the on-screen keyboard. Connection/tag suggestion lists render via
 * portal + fixed positioning above the input so they are not clipped by the drawer.
 */
const DRAWER_EXPANDED_MAX_HEIGHT = 'clamp(300px, 58vh, 680px)';

const S = {
  wrap: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0a0c14', position: 'relative', overflow: 'hidden',
  },
  /** Scrolls title bar + folder tools + editor when the header is taller than the viewport (e.g. DM AI Tools on campaign/world). */
  mainScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
  },
  header: {
    padding: '20px 24px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    paddingBottom: '16px', flexShrink: 0,
  },
  /** Editor column when nested inside mainScroll — fixed clamp height so inner textarea can scroll. */
  bodyInScroll: {
    flex: '0 0 auto',
    height: 'clamp(260px, 58vh, 720px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  titleRow: { display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' },
  titleInput: {
    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
    fontFamily: 'Cinzel', fontSize: '20px', color: '#e2d5bb', fontWeight: '500',
    padding: '4px 0', width: '100%',
  },
  metaRow: {
    display: 'flex', gap: '12px', alignItems: 'center',
    overflowX: 'auto', flexWrap: 'nowrap',
    scrollbarWidth: 'none', // Firefox
    msOverflowStyle: 'none', // IE
  },
  select: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px', color: '#e2d5bb', fontSize: '13px',
    fontFamily: 'Cinzel', padding: '5px 10px', outline: 'none', cursor: 'pointer',
  },
  toggleShared: (shared) => ({
    padding: '5px 12px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.15em',
    border: '1px solid',
    background: shared ? 'rgba(200,148,58,0.15)' : 'transparent',
    borderColor: shared ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.1)',
    color: shared ? '#c8943a' : 'rgba(226,213,187,0.4)',
    transition: 'all 0.2s',
  }),
  saveBtn: (dirty) => ({
    marginLeft: 'auto', padding: '5px 16px',
    background: dirty ? 'linear-gradient(135deg, #c8943a, #a07030)' : 'transparent',
    border: `1px solid ${dirty ? 'transparent' : 'rgba(226,213,187,0.2)'}`,
    borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.15em',
    color: dirty ? '#07080e' : 'rgba(226,213,187,0.6)',
    transition: 'all 0.2s',
  }),
  viewToggle: {
    display: 'flex', gap: '4px', padding: '2px',
    background: 'rgba(255,255,255,0.04)', borderRadius: '4px',
  },
  viewBtn: (active) => ({
    padding: '4px 10px', borderRadius: '3px', border: 'none', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em',
    background: active ? 'rgba(200,148,58,0.2)' : 'transparent',
    color: active ? '#c8943a' : 'rgba(226,213,187,0.35)',
    transition: 'all 0.2s',
  }),
  body: {
    flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
  },
  editor: {
    flex: 1, width: '100%', minHeight: 0, background: 'transparent',
    border: 'none', outline: 'none', resize: 'none',
    color: '#e2d5bb', fontSize: '16px', fontFamily: 'Crimson Pro, serif',
    lineHeight: '1.8', padding: '20px 24px',
    overflowY: 'auto',
  },
  preview: {
    flex: 1, overflowY: 'auto', padding: '20px 24px',
    fontFamily: 'Crimson Pro, serif', fontSize: '16px',
    lineHeight: '1.8', color: '#e2d5bb',
  },
  connections: {
    borderTop: '1px solid rgba(255,255,255,0.05)',
    padding: '14px 24px', flexShrink: 0,
    background: 'rgba(0,0,0,0.2)',
  },
  connLabel: {
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.2em',
    color: 'rgba(200,148,58,0.5)', marginBottom: '10px', textTransform: 'uppercase',
  },
  connList: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' },
  connTag: (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '3px 10px', borderRadius: '20px',
    background: `${color}18`, border: `1px solid ${color}50`,
    fontSize: '13px', fontFamily: 'Crimson Pro, serif', color: '#e2d5bb',
  }),
  connRemove: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'rgba(226,213,187,0.3)', fontSize: '14px', padding: '0',
    lineHeight: '1',
  },
  connSearch: {
    position: 'relative', display: 'inline-block',
  },
  connInput: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px', color: '#e2d5bb', fontSize: '13px',
    fontFamily: 'Crimson Pro, serif', padding: '4px 10px', outline: 'none',
    width: '200px',
  },
  dropdown: {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
    background: '#141820', border: '1px solid rgba(200,148,58,0.25)',
    borderRadius: '3px', minWidth: '200px', zIndex: 250,
    maxHeight: 'min(240px, 42vh)', overflowY: 'auto',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.6)',
  },
  dropItem: {
    padding: '8px 12px', cursor: 'pointer', fontSize: '14px',
    fontFamily: 'Crimson Pro, serif', color: '#e2d5bb',
    display: 'flex', alignItems: 'center', gap: '8px',
  },
};

export default function NoteEditor({
  note,
  notes,
  connections,
  currentUser,
  dmCampaignIds,
  simulatedRole,
  onSave,
  onDelete,
  isMobile,
  onBackToList,
  /** Open a referenced note in the side peek stack (e.g. `note:` link in preview or “Open source note”). */
  onOpenReferenceNote,
  /** After AI creates a note (NPC / continuity), select it in the sidebar and refresh the list. */
  onSelectNote,
}) {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [category, setCategory] = useState(note?.category || 'general');
  const [significance, setSignificance] = useState(note?.significance || 'standard');
  const [narrativeWeight, setNarrativeWeight] = useState(note?.narrative_weight || 'node');
  const [isShared, setIsShared] = useState(!!note?.is_shared);
  const [dirty, setDirty] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('chronicler_viewMode') || 'view');
  const setAndPersistViewMode = (m) => { setViewMode(m); localStorage.setItem('chronicler_viewMode', m); };
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [connSearch, setConnSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMove, setShowMove] = useState(false);
  // Bottom drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('connections'); // 'connections'|'tags'|'images'|'permissions'
  // Tags
  const [tags, setTags] = useState(note?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  // Images
  const [images, setImages] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showMdHelp, setShowMdHelp] = useState(false);
  const imageInputRef = useRef(null);
  /** Hidden file input for DM/admin sidebar icon uploads (folders + notes). */
  const sidebarIconInputRef = useRef(null);
  const [uploadingSidebarIcon, setUploadingSidebarIcon] = useState(false);
  const titleInputRef = useRef(null);
  // Permissions
  const [noteVisibility, setNoteVisibility] = useState(note?.visibility || 'hidden');
  const [grantedUsers, setGrantedUsers] = useState(note?.granted_users || []);
  const [allUsers, setAllUsers] = useState([]);
  const [cascadeChildren, setCascadeChildren] = useState(false);
  // DM Only flag
  const [isDmOnly, setIsDmOnly] = useState(!!note?.is_dm_only);
  /** Optional emoji + short blurb for sidebar tree (saved to display_icon / display_summary) */
  const [displayIcon, setDisplayIcon] = useState(note?.display_icon || '');
  const [displaySummary, setDisplaySummary] = useState(note?.display_summary || '');
  /** Modal: pick note sidebar emoji from categorized + all-icons grid */
  const [noteIconMenuOpen, setNoteIconMenuOpen] = useState(false);
  const uniqueNotePresetIcons = useMemo(() => allUniqueNotePresetIcons(), []);
  // Campaign member management (root folder only)
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [allSystemUsers, setAllSystemUsers] = useState([]); // all users for add-member dropdown
  // In-session undo/redo
  const undoStack = useRef([]); // [{title, content}]
  const redoStack = useRef([]);
  const skipUndoPush = useRef(false);
  // Server version tracking for conflict detection
  const serverUpdatedAt = useRef(note?.updated_at || null);
  // Conflict state
  const [conflict, setConflict] = useState(null); // { serverTitle, serverContent, serverUpdatedAt, myTitle, myContent }
  /** @mention dropdown: items from API, replace range, highlight index; `field` is body or DM AI prompt key. */
  const [mentionPopup, setMentionPopup] = useState(null);
  const mentionPopupRef = useRef(null);
  const mentionDebounceRef = useRef(null);
  const contentTextareaRef = useRef(null);
  /** Viewport-fixed rect for portaled DM AI prompt @mention list (anchored above the active textarea). */
  const [mentionPromptFixed, setMentionPromptFixed] = useState(null);
  /** Anchors for portaled connection/tag suggestion dropdowns (fixed to viewport). */
  const connInputRef = useRef(null);
  const tagInputRef = useRef(null);
  /** Layout rects for createPortal dropdowns; null when closed or not measured. */
  const [connDropdownFixed, setConnDropdownFixed] = useState(null);
  const [tagDropdownFixed, setTagDropdownFixed] = useState(null);
  useEffect(() => {
    mentionPopupRef.current = mentionPopup;
  }, [mentionPopup]);
  // Refs to always-current handler functions (avoids stale closure in keydown listener)
  const handleUndoRef = useRef(null);
  const handleRedoRef = useRef(null);
  const isAdminUser = simulatedRole ? false : !!currentUser.is_admin;
  const isOwner     = simulatedRole === 'owner' ? true
    : simulatedRole ? false
    : (!note || note.user_id === currentUser.id);
  const isGranted   = simulatedRole === 'granted' ? true
    : simulatedRole ? false
    : (!isOwner && !isAdminUser && (note?.granted_users || []).includes(currentUser.id));

  // Check if current user is DM of this note's campaign
  const isDM = (() => {
    if (isAdminUser) return true;
    if (!note || !dmCampaignIds || dmCampaignIds.length === 0) return false;
    const notesById = new Map((notes || []).map((n) => [n.id, n]));
    let current = note;
    while (current.parent_id) {
      current = notesById.get(current.parent_id);
      if (!current) return false;
    }
    return dmCampaignIds.includes(current.id);
  })();

  const isRootFolder = !!note?.is_folder && !note?.parent_id;
  const canFullEdit = isRootFolder ? (isAdminUser || isDM) : (isAdminUser || isOwner || isGranted);
  const canManage   = isRootFolder ? (isAdminUser || isDM) : (isAdminUser || isOwner || isDM); // rename, delete, move, perms
  const canAppend   = isDM && !isOwner && !isGranted && !isAdminUser; // DM on someone else's note
  const notesByIdForArchive = useMemo(() => notesByIdMap(notes || []), [notes]);
  const underArchive =
    note?.under_completed_archive ??
    (note?.id != null ? isUnderCompletedArchive(notes, note.id) : false);
  /** Full edit of title/body (blocked when subtree is in completed archive, except admins). */
  const canEditContent = canFullEdit && (!underArchive || isAdminUser);
  /** DM append to another user's note — disabled in archived campaigns (non-admin). */
  const canAppendEffective = canAppend && (!underArchive || isAdminUser);
  /** Move, delete, permissions — disabled when archived for non-admin. */
  const canManageUi = canManage && (!underArchive || isAdminUser);
  /** Same as legacy `canEdit`: full content edit only (DM append uses a separate textarea). */
  const canEdit = canEditContent;
  /** Folders: icon + description when user can manage or fully edit the folder */
  const canFolderStyle = !!(note?.is_folder && (canManage || canFullEdit));
  const folderTreeKind = useMemo(() => {
    if (!note?.is_folder) return 'note';
    return getFolderTreeKind(note, notesByIdMap(notes || []));
  }, [note, notes]);

  /** DM AI Tools (NPC / location / item / continuity) only on world or campaign roots — not nested subfolders. */
  const dmAiRootOnly = folderTreeKind === 'world' || folderTreeKind === 'campaign';

  /** Only world/campaign scope roots may store `is_completed` (matches backend). */
  const scopeRootForCompletion = !!(note?.is_folder && isCompletionScopeRootNote(note, notesByIdForArchive));
  /** Owner, DM (folder_roles), or admin may flip completion — matches backend `canManage` + scope rules. */
  const canToggleCompletion =
    scopeRootForCompletion &&
    (isAdminUser || isOwner || (dmCampaignIds || []).includes(note.id));

  /**
   * Root folder for AI corpus: world root, or playable campaign folder for descendants.
   * Used for DM-only continuity + NPC folder listing.
   */
  const continuityFolderId = useMemo(() => {
    if (!note?.is_folder) return null;
    if (note.is_world && !note.parent_id) return note.id;
    const cid = getCampaignFolderIdForSelection(notes, note.id);
    return cid ?? note.id;
  }, [note, notes]);

  /**
   * All descendant folders under continuityFolderId (recursive), sorted by title — NPC target picker.
   */
  const descendantFolders = useMemo(() => {
    if (!continuityFolderId || !notes?.length) return [];
    const out = [];
    /** @param {number} pid */
    const walk = (pid) => {
      (notes || []).filter((n) => n.parent_id === pid && n.is_folder).forEach((n) => {
        out.push(n);
        walk(n.id);
      });
    };
    walk(continuityFolderId);
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }, [notes, continuityFolderId]);

  const [aiAdminStatus, setAiAdminStatus] = useState({ ai_enabled: false });
  const [npcPrompt, setNpcPrompt] = useState('');
  const [npcParentId, setNpcParentId] = useState(null);
  const [npcDmOnly, setNpcDmOnly] = useState(false);
  const [npcBusy, setNpcBusy] = useState(false);
  const [npcErr, setNpcErr] = useState('');
  const [locPrompt, setLocPrompt] = useState('');
  const [locParentId, setLocParentId] = useState(null);
  const [locDmOnly, setLocDmOnly] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locErr, setLocErr] = useState('');
  const [itemPrompt, setItemPrompt] = useState('');
  const [itemParentId, setItemParentId] = useState(null);
  const [itemDmOnly, setItemDmOnly] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [itemErr, setItemErr] = useState('');
  const [contBusy, setContBusy] = useState(false);
  const [contErr, setContErr] = useState('');
  /** Player lore summary (POST /ai/summarize) for archived campaigns. */
  const [summarizeBusy, setSummarizeBusy] = useState(false);
  const [summarizeErr, setSummarizeErr] = useState('');
  const [summarizeText, setSummarizeText] = useState('');
  const [completionBusy, setCompletionBusy] = useState(false);
  /** Shown when PUT /notes/:id for completion fails (e.g. permission); cleared on success and note change. */
  const [completionToggleErr, setCompletionToggleErr] = useState('');
  /** Mirrors DM AI prompt strings for debounced mention fetch; updated in textarea onChange / applyMentionChoice. */
  const npcPromptRef = useRef('');
  const locPromptRef = useRef('');
  const itemPromptRef = useRef('');
  const npcPromptTextareaRef = useRef(null);
  const locPromptTextareaRef = useRef(null);
  const itemPromptTextareaRef = useRef(null);

  useEffect(() => {
    if (!note?.id) return;
    api.get('/admin/ai/status').then((r) => setAiAdminStatus(r.data)).catch(() => {});
  }, [note?.id]);

  useEffect(() => {
    setNpcParentId(null);
    setLocParentId(null);
    setItemParentId(null);
  }, [note?.id]);

  useEffect(() => {
    if (npcParentId != null) return;
    if (!continuityFolderId) return;
    const def = descendantFolders.find((f) => /^npcs?$/i.test(String(f.title || '').trim()))?.id
      ?? descendantFolders[0]?.id
      ?? continuityFolderId;
    setNpcParentId(def ?? null);
  }, [npcParentId, descendantFolders, continuityFolderId]);

  useEffect(() => {
    if (locParentId != null) return;
    if (!continuityFolderId) return;
    const def = descendantFolders.find((f) => /^locations?$/i.test(String(f.title || '').trim()))?.id
      ?? descendantFolders[0]?.id
      ?? continuityFolderId;
    setLocParentId(def ?? null);
  }, [locParentId, descendantFolders, continuityFolderId]);

  useEffect(() => {
    if (itemParentId != null) return;
    if (!continuityFolderId) return;
    const def = descendantFolders.find((f) =>
      /items?|artifacts?/i.test(String(f.title || '').trim())
    )?.id
      ?? descendantFolders[0]?.id
      ?? continuityFolderId;
    setItemParentId(def ?? null);
  }, [itemParentId, descendantFolders, continuityFolderId]);

  /**
   * POST /api/ai/npc-generate — creates a note under the chosen folder; optional onSelectNote.
   */
  const handleNpcGenerate = async () => {
    if (!npcParentId || !npcPrompt.trim()) {
      setNpcErr('Choose a folder and enter a prompt.');
      return;
    }
    if (!aiAdminStatus.ai_enabled) {
      setNpcErr('AI is disabled in Admin settings.');
      return;
    }
    setNpcBusy(true);
    setNpcErr('');
    try {
      const res = await api.post('/ai/npc-generate', {
        parent_id: npcParentId,
        prompt: npcPrompt.trim(),
        category: 'npc',
        is_dm_only: npcDmOnly,
      });
      if (onSelectNote && res.data?.note?.id) onSelectNote(res.data.note.id);
      else if (onSave) onSave(res.data?.note);
    } catch (e) {
      setNpcErr(e.response?.data?.error || e.message || 'NPC generation failed');
    } finally {
      setNpcBusy(false);
    }
  };

  /**
   * POST /api/ai/continuity/:folderId/generate — DM-only report note under the campaign/world root.
   */
  const handleContinuityGenerate = async () => {
    if (!continuityFolderId) return;
    if (!aiAdminStatus.ai_enabled) {
      setContErr('AI is disabled in Admin settings.');
      return;
    }
    setContBusy(true);
    setContErr('');
    try {
      const res = await api.post(`/ai/continuity/${continuityFolderId}/generate`);
      if (onSelectNote && res.data?.note?.id) onSelectNote(res.data.note.id);
      else if (onSave) onSave();
    } catch (e) {
      setContErr(e.response?.data?.error || e.message || 'Continuity generation failed');
    } finally {
      setContBusy(false);
    }
  };

  /**
   * POST /api/ai/location-generate — location note under chosen folder.
   */
  const handleLocationGenerate = async () => {
    if (!locParentId || !locPrompt.trim()) {
      setLocErr('Choose a folder and enter a prompt.');
      return;
    }
    if (!aiAdminStatus.ai_enabled) {
      setLocErr('AI is disabled in Admin settings.');
      return;
    }
    setLocBusy(true);
    setLocErr('');
    try {
      const res = await api.post('/ai/location-generate', {
        parent_id: locParentId,
        prompt: locPrompt.trim(),
        is_dm_only: locDmOnly,
      });
      if (onSelectNote && res.data?.note?.id) onSelectNote(res.data.note.id);
      else if (onSave) onSave(res.data?.note);
    } catch (e) {
      setLocErr(e.response?.data?.error || e.message || 'Location generation failed');
    } finally {
      setLocBusy(false);
    }
  };

  /**
   * POST /api/ai/item-generate — item / artifact note under chosen folder.
   */
  const handleItemGenerate = async () => {
    if (!itemParentId || !itemPrompt.trim()) {
      setItemErr('Choose a folder and enter a prompt.');
      return;
    }
    if (!aiAdminStatus.ai_enabled) {
      setItemErr('AI is disabled in Admin settings.');
      return;
    }
    setItemBusy(true);
    setItemErr('');
    try {
      const res = await api.post('/ai/item-generate', {
        parent_id: itemParentId,
        prompt: itemPrompt.trim(),
        is_dm_only: itemDmOnly,
      });
      if (onSelectNote && res.data?.note?.id) onSelectNote(res.data.note.id);
      else if (onSave) onSave(res.data?.note);
    } catch (e) {
      setItemErr(e.response?.data?.error || e.message || 'Item generation failed');
    } finally {
      setItemBusy(false);
    }
  };

  /**
   * Sets `is_completed` on a world/campaign scope root; descendants become read-only until cleared.
   * @param {boolean} nextChecked - Target completed flag from the checkbox.
   */
  const handleCompletionToggle = async (nextChecked) => {
    if (!note?.id || !canToggleCompletion) return;
    setCompletionBusy(true);
    setCompletionToggleErr('');
    try {
      const res = await api.put(`/notes/${note.id}`, { is_completed: nextChecked ? 1 : 0 });
      const row = res.data || {};
      // Parent merges by id; always pass numeric id + explicit is_completed so the checkbox state updates even if types differ.
      if (onSave) {
        onSave({
          ...row,
          id: note.id,
          is_completed: nextChecked ? 1 : 0,
        });
      }
    } catch (e) {
      console.error(e);
      setCompletionToggleErr(
        e.response?.data?.error || e.message || 'Could not update completion status',
      );
    } finally {
      setCompletionBusy(false);
    }
  };

  /**
   * POST /api/ai/summarize/:noteId — player-safe lore recap when the scope is marked completed.
   */
  const handlePlayerSummarize = async () => {
    if (!note?.id || note.is_folder) return;
    setSummarizeBusy(true);
    setSummarizeErr('');
    setSummarizeText('');
    try {
      const res = await api.post(`/ai/summarize/${note.id}`);
      setSummarizeText(res.data?.summary || '');
    } catch (e) {
      setSummarizeErr(e.response?.data?.error || e.message || 'Summarization failed');
    } finally {
      setSummarizeBusy(false);
    }
  };

  const autoSaveTimer = useRef(null);
  const [appendContent, setAppendContent] = useState('');
  const [appendSaving, setAppendSaving] = useState(false);

  // Refs for beforeunload (need current values without stale closures)
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const displayIconRef = useRef(displayIcon);
  const displaySummaryRef = useRef(displaySummary);
  const categoryRef = useRef(category);
  const significanceRef = useRef(significance);
  const narrativeWeightRef = useRef(narrativeWeight);
  const dirtyRef = useRef(dirty);
  const noteIdRef = useRef(note?.id);
  titleRef.current = title;
  contentRef.current = content;
  displayIconRef.current = displayIcon;
  displaySummaryRef.current = displaySummary;
  categoryRef.current = category;
  significanceRef.current = significance;
  narrativeWeightRef.current = narrativeWeight;
  dirtyRef.current = dirty;
  noteIdRef.current = note?.id;
  // Note connections
  const myConns = connections.filter(c =>
    c.source_note_id === note?.id || c.target_note_id === note?.id
  );

  // Reset state when note changes (id or override linkage).
  const noteSlotKey = `${note?.id ?? ''}-${note?.source_note_id ?? ''}`;
  useEffect(() => {
    setTitle(note?.title || '');
    setContent(note?.content || '');
    setCategory(note?.category || 'general');
    setSignificance(note?.significance || 'standard');
    setNarrativeWeight(note?.narrative_weight || 'node');
    setIsShared(note?.visibility === 'shared');
    setNoteVisibility(note?.visibility || 'hidden');
    setGrantedUsers(note?.granted_users || []);
    setTags(note?.tags || []);
    setIsDmOnly(!!note?.is_dm_only);
    setDisplayIcon(note?.display_icon || '');
    setDisplaySummary(note?.display_summary || '');
    setTagInput('');
    setDirty(false);
    setSavedAt(null);
    setViewMode(localStorage.getItem('chronicler_viewMode') || 'view');
    setDrawerOpen(false);
    setDrawerTab('connections');
    setAddMemberSearch('');
    undoStack.current = [];
    redoStack.current = [];
    serverUpdatedAt.current = note?.updated_at || null;
    setConflict(null);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setNoteIconMenuOpen(false);
    setMentionPopup(null);
    setSummarizeText('');
    setSummarizeErr('');
    setCompletionToggleErr('');
  }, [noteSlotKey]);

  useEffect(() => () => {
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
  }, []);

  useEffect(() => {
    if (!noteIconMenuOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setNoteIconMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [noteIconMenuOpen]);

  // Sync tags + permissions when server data updates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTags(note?.tags || []); }, [JSON.stringify(note?.tags)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNoteVisibility(note?.visibility || 'hidden');
    setGrantedUsers(note?.granted_users || []);
  }, [note?.visibility, JSON.stringify(note?.granted_users)]);

  // Sync title/content from server when note updates externally (e.g. WS push from another user).
  // Only applies when editor is clean — never overwrite unsaved local changes.
  // Skips null/undefined values so a loadData refresh (which omits content) doesn't blank the editor.
  useEffect(() => {
    if (dirty) return;
    if (note?.title != null) setTitle(note.title);
    if (note?.content != null) setContent(note.content);
    serverUpdatedAt.current = note?.updated_at || serverUpdatedAt.current;
  }, [note?.title, note?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load images for this note
  useEffect(() => {
    if (!note?.id) return;
    api.get(`/images/note/${note.id}`).then(r => setImages(r.data)).catch(() => {});
  }, [note?.id]);

  // Load all tags for autocomplete (once)
  useEffect(() => {
    api.get('/notes/meta/tags').then(r => setAllTags(r.data.map(t => t.tag))).catch(() => {});
  }, []);

  // Load users for permissions panel — scoped to campaign members if inside a campaign
  useEffect(() => {
    if (!canManage) return;
    if (isRootFolder) {
      // We ARE the root — fetch this campaign's members directly
      api.get('/notes/meta/users', { params: { campaign_id: note.id } }).then(r => setAllUsers(r.data)).catch(() => {});
    } else {
      // Walk up to find root campaign folder id
      const notesById = new Map((notes || []).map(n => [n.id, n]));
      let current = note;
      while (current?.parent_id) current = notesById.get(current.parent_id);
      const rootId = current?.id;
      const params = rootId ? { campaign_id: rootId } : {};
      api.get('/notes/meta/users', { params }).then(r => setAllUsers(r.data)).catch(() => {});
    }
  }, [note?.id, isRootFolder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load all system users for add-member dropdown (root folders only)
  useEffect(() => {
    if (!isRootFolder || !canManage) return;
    api.get('/notes/meta/users').then(r => setAllSystemUsers(r.data)).catch(() => {});
  }, [isRootFolder, note?.id]);


  // Keyboard undo/redo (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y)
  // Uses refs so the listener never goes stale
  useEffect(() => {
    const handler = (e) => {
      if (!canEdit) return;
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current?.();
      } else if (isCtrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]); // only re-registers if canEdit changes

  // Save on page close / tab unload
  useEffect(() => {
    const handleUnload = () => {
      if (!dirtyRef.current || !noteIdRef.current || !canEdit) return;
      const body = JSON.stringify({
        title: titleRef.current,
        content: contentRef.current,
        category: categoryRef.current,
      });
      navigator.sendBeacon
        ? navigator.sendBeacon(`/api/notes/${noteIdRef.current}`, new Blob([body], { type: 'application/json' }))
        : api.put(`/notes/${noteIdRef.current}`, JSON.parse(body)).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [isOwner]);

  const doSave = useCallback(async (overrides = {}) => {
    if (!noteIdRef.current || !canEdit) return;
    const payload = {
      title: titleRef.current,
      content: contentRef.current,
      category: categoryRef.current,
      significance: significanceRef.current,
      narrative_weight: narrativeWeightRef.current,
      display_icon: displayIconRef.current === '' ? null : displayIconRef.current,
      display_summary: displaySummaryRef.current === '' ? null : displaySummaryRef.current,
      client_updated_at: serverUpdatedAt.current,
      ...overrides,
    };
    if (!payload.title?.trim()) return;
    setSaving(true);
    try {
      const res = await api.put(`/notes/${noteIdRef.current}`, payload);
      // Update our tracked server timestamp so next save has the right baseline
      serverUpdatedAt.current = res.data?.updated_at || serverUpdatedAt.current;
      setDirty(false);
      setSavedAt(new Date());
      if (onSave) onSave(res.data);
    } catch (err) {
      if (err.response?.status === 409) {
        const d = err.response.data;
        setConflict({
          serverTitle:      d.server_title,
          serverContent:    d.server_content,
          serverUpdatedAt:  d.server_updated_at,
          serverUpdatedBy:  d.server_updated_by,
          myTitle:          titleRef.current,
          myContent:        contentRef.current,
        });
      } else {
        console.error('Save failed', err);
      }
    } finally {
      setSaving(false);
    }
  }, [isOwner, onSave]);

  /**
   * Persists a new sidebar icon URL (emoji preset, upload, or AI-generated) and syncs server timestamp.
   * @param {string} url
   */
  const persistSidebarIconUrl = useCallback(async (url) => {
    if (!noteIdRef.current) return;
    setDisplayIcon(url);
    const res = await api.put(`/notes/${noteIdRef.current}`, {
      client_updated_at: serverUpdatedAt.current,
      display_icon: url,
      display_summary: displaySummaryRef.current === '' ? null : displaySummaryRef.current,
    });
    serverUpdatedAt.current = res.data?.updated_at || serverUpdatedAt.current;
    if (onSave) onSave(res.data);
  }, [onSave]);

  /**
   * Saves a note sidebar emoji or clears to category default (null `display_icon` on server).
   * @param {string|null|undefined} emoji
   * @param {{ closeMenu?: boolean }} [opts]
   */
  const persistNoteDisplayIcon = useCallback(async (emoji, opts = {}) => {
    const { closeMenu = true } = opts;
    if (!noteIdRef.current) return;
    const cleared = emoji === null || emoji === undefined || emoji === '';
    const nextStr = cleared ? '' : String(emoji);
    setDisplayIcon(nextStr);
    try {
      const res = await api.put(`/notes/${noteIdRef.current}`, {
        client_updated_at: serverUpdatedAt.current,
        display_icon: cleared ? null : nextStr,
        display_summary: displaySummaryRef.current === '' ? null : displaySummaryRef.current,
      });
      serverUpdatedAt.current = res.data?.updated_at || serverUpdatedAt.current;
      if (onSave) onSave(res.data);
      if (closeMenu) setNoteIconMenuOpen(false);
    } catch (e) {
      console.error(e);
    }
  }, [onSave]);

  /**
   * Handles image pick for the note-list icon: POSTs to /images/sidebar-icon then PUTs display_icon.
   * Restricted to DMs and admins on the server; replaces any prior managed image file.
   * @param {import('react').ChangeEvent<HTMLInputElement>} e
   */
  const handleSidebarIconFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !noteIdRef.current || !isDM) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      setUploadingSidebarIcon(true);
      const up = await api.post(`/images/sidebar-icon/${noteIdRef.current}`, fd);
      const url = up.data?.url;
      if (!url) return;
      await persistSidebarIconUrl(url);
      setNoteIconMenuOpen(false);
    } catch (err) {
      console.error('Sidebar icon upload failed', err);
    } finally {
      setUploadingSidebarIcon(false);
    }
  }, [isDM, persistSidebarIconUrl]);

  const tagSuggestions = useMemo(
    () => allTags.filter((t) => t.includes(tagInput.toLowerCase()) && !tags.includes(t)).slice(0, 6),
    [allTags, tagInput, tags],
  );

  const filteredNotes = useMemo(() => {
    const connsHere = connections.filter(
      (c) => c.source_note_id === note?.id || c.target_note_id === note?.id,
    );
    const ids = new Set(
      connsHere.map((c) => (c.source_note_id === note?.id ? c.target_note_id : c.source_note_id)),
    );
    return notes
      .filter(
        (n) =>
          n.id !== note?.id &&
          !ids.has(n.id) &&
          n.title.toLowerCase().includes(connSearch.toLowerCase()),
      )
      .slice(0, 8);
  }, [notes, note?.id, connSearch, connections]);

  /**
   * Updates fixed-position rect for the connection suggestion portal from connInputRef.
   * Side effect: sets connDropdownFixed state.
   */
  const updateConnDropdownFixed = useCallback(() => {
    if (!showDropdown || !connSearch || !filteredNotes.length) {
      setConnDropdownFixed(null);
      return;
    }
    setConnDropdownFixed(getFixedDropdownAboveInput(connInputRef.current));
  }, [showDropdown, connSearch, filteredNotes.length]);

  /**
   * Updates fixed-position rect for the tag suggestion portal from tagInputRef.
   * Side effect: sets tagDropdownFixed state.
   */
  const updateTagDropdownFixed = useCallback(() => {
    if (!showTagSuggestions || !tagSuggestions.length) {
      setTagDropdownFixed(null);
      return;
    }
    setTagDropdownFixed(getFixedDropdownAboveInput(tagInputRef.current, 140));
  }, [showTagSuggestions, tagSuggestions.length]);

  /**
   * Debounced @mention fetch for DM AI NPC / location / item prompt textareas; same API as the main body.
   * @param {'npc'|'loc'|'item'} field - Which prompt state to validate after the debounce delay.
   * @param {string} text - Current textarea value.
   * @param {number} cursor - Caret index.
   */
  const schedulePromptMention = useCallback((field, text, cursor) => {
    if (field === 'npc') npcPromptRef.current = text;
    if (field === 'loc') locPromptRef.current = text;
    if (field === 'item') itemPromptRef.current = text;
    if (!note?.id) {
      setMentionPopup((prev) => (prev?.field === field ? null : prev));
      return;
    }
    const parsed = parseMentionAtCursor(text, cursor);
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    if (!parsed || parsed.query.trim().length < 3) {
      setMentionPopup((prev) => (prev?.field === field ? null : prev));
      return;
    }
    const anchorMap = {
      npc: npcPromptTextareaRef,
      loc: locPromptTextareaRef,
      item: itemPromptTextareaRef,
    };
    mentionDebounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/notes/meta/mention-suggestions', {
          params: { from_note_id: note.id, q: parsed.query.trim() },
        });
        const items = Array.isArray(res.data) ? res.data : [];
        const valMap = { npc: npcPromptRef, loc: locPromptRef, item: itemPromptRef };
        const curText = valMap[field].current;
        const el = anchorMap[field].current;
        const curCursor = el?.selectionStart ?? curText.length;
        const again = parseMentionAtCursor(curText, curCursor);
        if (!again || again.query.trim().length < 3) {
          setMentionPopup((prev) => (prev?.field === field ? null : prev));
          return;
        }
        setMentionPopup({
          items,
          replaceStart: again.replaceStart,
          replaceEnd: again.replaceEnd,
          activeIndex: 0,
          field,
          anchorRef: anchorMap[field],
        });
      } catch {
        setMentionPopup((prev) => (prev?.field === field ? null : prev));
      }
    }, 220);
  }, [note?.id]);

  useLayoutEffect(() => {
    updateConnDropdownFixed();
    if (!showDropdown || !connSearch || !filteredNotes.length) return undefined;
    const onMove = () => updateConnDropdownFixed();
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    };
  }, [
    showDropdown,
    connSearch,
    filteredNotes.length,
    drawerOpen,
    drawerTab,
    updateConnDropdownFixed,
  ]);

  useLayoutEffect(() => {
    updateTagDropdownFixed();
    if (!showTagSuggestions || !tagSuggestions.length) return undefined;
    const onMove = () => updateTagDropdownFixed();
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    };
  }, [
    showTagSuggestions,
    tagSuggestions.length,
    drawerOpen,
    drawerTab,
    updateTagDropdownFixed,
  ]);

  /** Positions the portaled DM AI @mention list above the active prompt textarea; updates on scroll/resize. */
  useLayoutEffect(() => {
    if (!mentionPopup || !mentionPopup.field || mentionPopup.field === 'body') {
      setMentionPromptFixed(null);
      return undefined;
    }
    const anchorRef = mentionPopup.anchorRef;
    const measure = () => setMentionPromptFixed(getFixedDropdownAboveInput(anchorRef?.current));
    measure();
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      document.removeEventListener('scroll', onMove, true);
    };
  }, [mentionPopup]);

  const markDirty = () => {
    setDirty(true);
    if (!skipUndoPush.current) {
      undoStack.current = [...undoStack.current.slice(-49), { title, content }];
      redoStack.current = [];
    }
    skipUndoPush.current = false;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(), 1500);
  };

  const handleUndo = () => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, { title, content }];
    skipUndoPush.current = true;
    setTitle(prev.title);
    setContent(prev.content);
    setDirty(true);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(), 1500);
  };
  handleUndoRef.current = handleUndo;

  const handleRedo = () => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, { title, content }];
    skipUndoPush.current = true;
    setTitle(next.title);
    setContent(next.content);
    setDirty(true);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(), 1500);
  };
  handleRedoRef.current = handleRedo;



  const handleSave = () => doSave();

  const handleAddConnection = async (targetNote) => {
    if (!note?.id) return;
    try {
      await api.post('/connections', {
        source_note_id: note.id,
        target_note_id: targetNote.id,
      });
      onSave(null); // trigger parent refresh
    } catch (err) {
      console.error(err);
    }
    setConnSearch('');
    setShowDropdown(false);
  };

  const handleRemoveConnection = async (connId) => {
    try {
      await api.delete(`/connections/${connId}`);
      onSave(null);
    } catch (err) {
      console.error(err);
    }
  };

  const saveTagsDirectly = async (newTags) => {
    if (!note?.id) return;
    await onSave({ tags: newTags });
  };

  const handleAddTag = (tag) => {
    const clean = tag.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || tags.includes(clean)) return;
    const next = [...tags, clean];
    setTags(next);
    setTagInput('');
    setShowTagSuggestions(false);
    saveTagsDirectly(next);
  };

  const handleRemoveTag = (tag) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    saveTagsDirectly(next);
  };

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); handleAddTag(tagInput); }
    if (e.key === 'Backspace' && !tagInput && tags.length) handleRemoveTag(tags[tags.length - 1]);
    if (e.key === 'Escape') { setShowTagSuggestions(false); setTagInput(''); }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await api.post(`/images/upload/${note.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImages(prev => [...prev, res.data]);
    } catch (err) { console.error('Upload failed', err); }
    setUploadingImage(false);
    e.target.value = '';
  };

  const handleDeleteImage = async (imgId) => {
    try {
      await api.delete(`/images/${imgId}`);
      setImages(prev => prev.filter(i => i.id !== imgId));
    } catch (err) { console.error(err); }
  };

  const insertImageMarkdown = (img) => {
    const md = `\n![${img.original_name}](${img.url})\n`;
    setContent(prev => prev + md);
    markDirty();
  };

  const savePermissions = async (newVisibility, newGranted, cascade = false) => {
    if (!note?.id) return;
    await onSave({ visibility: newVisibility, granted_users: newGranted, cascade_children: cascade });
  };

  const handleVisibilityChange = (newVis) => {
    if (newVis === 'shared') {
      // "Party Shared" = grant every current party member individually, keep visibility hidden
      // Never use visibility='shared' which leaks to all users system-wide
      const allPartyIds = allUsers.map(u => u.id);
      setNoteVisibility('hidden');
      setIsShared(false);
      setGrantedUsers(allPartyIds);
      savePermissions('hidden', allPartyIds, cascadeChildren);
    } else {
      // "Hidden" = clear all grants
      setNoteVisibility('hidden');
      setIsShared(false);
      setGrantedUsers([]);
      savePermissions('hidden', [], cascadeChildren);
    }
  };

  const handleGrantToggle = (userId) => {
    const next = grantedUsers.includes(userId)
      ? grantedUsers.filter(id => id !== userId)
      : [...grantedUsers, userId];
    setGrantedUsers(next);
    savePermissions(noteVisibility, next, cascadeChildren);
  };

  const handleDmOnlyToggle = async () => {
    const next = !isDmOnly;
    setIsDmOnly(next);
    try {
      await api.put(`/notes/${note.id}`, { is_dm_only: next ? 1 : 0 });
      if (onSave) onSave();
    } catch (err) {
      setIsDmOnly(!next); // revert
      console.error(err);
    }
  };

  const handleAddMember = async (userId) => {
    if (!note?.id) return;
    const user = allSystemUsers.find(u => u.id === userId);
    if (!user) return;
    // Optimistic add
    setAllUsers(prev => [...prev, { ...user, is_dm: 0 }]);
    setAddMemberSearch('');
    setShowAddMember(false);
    try {
      await api.put(`/notes/${note.id}/members`, { add_user_id: userId });
    } catch (err) {
      // Revert on failure
      setAllUsers(prev => prev.filter(u => u.id !== userId));
      console.error(err);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!note?.id) return;
    const prev = allUsers;
    // Optimistic remove
    setAllUsers(p => p.filter(u => u.id !== userId));
    try {
      await api.put(`/notes/${note.id}/members`, { remove_user_id: userId });
    } catch (err) {
      setAllUsers(prev);
      console.error(err);
    }
  };

  const handleToggleDM = async (userId, currentlyDM) => {
    if (!note?.id) return;
    // Optimistic flip
    setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, is_dm: currentlyDM ? 0 : 1 } : u));
    try {
      await api.put(`/notes/${note.id}/members`, { set_dm: { user_id: userId, is_dm: !currentlyDM } });
    } catch (err) {
      // Revert on failure
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, is_dm: currentlyDM ? 1 : 0 } : u));
      console.error(err);
    }
  };

  if (!note) {
    return (
      <div style={{ ...S.wrap, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', opacity: 0.3 }}>
          <div style={{ fontFamily: 'Cinzel', fontSize: '14px', letterSpacing: '0.2em', marginBottom: '8px', color: '#c8943a' }}>
            SELECT A NOTE
          </div>
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', marginBottom: isMobile ? '20px' : 0 }}>
            or create a new one from the sidebar
          </div>
          {isMobile && (
            <button
              onClick={onBackToList}
              style={{ marginTop: '16px', padding: '12px 28px', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.4)', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.15em', color: '#c8943a', opacity: 1 }}
            >
              BROWSE NOTES
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * Inserts a markdown link `[title](note:id)` for the chosen suggestion and closes the mention UI.
   * Writes into the main body or the active DM AI prompt field per `mentionPopup.field`.
   * @param {{ id: number, title: string }} item - Suggestion row from `/notes/meta/mention-suggestions`.
   */
  const applyMentionChoice = (item) => {
    const mp = mentionPopupRef.current;
    if (!mp || !item?.id) return;
    const { replaceStart, replaceEnd, field = 'body' } = mp;
    const safeTitle = (item.title || 'Note').replace(/\]/g, '›');
    const md = `[${safeTitle}](note:${item.id})`;

    const focusPrompt = (taRef, pos) => {
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.selectionStart = ta.selectionEnd = pos;
          ta.focus();
        }
      });
    };

    if (field === 'body') {
      const val = contentRef.current;
      const newVal = val.slice(0, replaceStart) + md + val.slice(replaceEnd);
      setContent(newVal);
      markDirty();
      setMentionPopup(null);
      requestAnimationFrame(() => {
        const ta = contentTextareaRef.current;
        if (ta) {
          const pos = replaceStart + md.length;
          ta.selectionStart = ta.selectionEnd = pos;
          ta.focus();
        }
      });
      return;
    }

    const applyPrompt = (getter, setter, ref, taRef) => {
      const val = getter();
      const newVal = val.slice(0, replaceStart) + md + val.slice(replaceEnd);
      setter(newVal);
      ref.current = newVal;
      setMentionPopup(null);
      focusPrompt(taRef, replaceStart + md.length);
    };

    if (field === 'npc') {
      applyPrompt(() => npcPromptRef.current, setNpcPrompt, npcPromptRef, npcPromptTextareaRef);
      return;
    }
    if (field === 'loc') {
      applyPrompt(() => locPromptRef.current, setLocPrompt, locPromptRef, locPromptTextareaRef);
      return;
    }
    if (field === 'item') {
      applyPrompt(() => itemPromptRef.current, setItemPrompt, itemPromptRef, itemPromptTextareaRef);
    }
  };

  /**
   * Keyboard handling for DM AI prompt textareas when an @mention list is open (↑↓ Enter Tab Escape).
   * @param {React.KeyboardEvent<HTMLTextAreaElement>} e
   * @param {'npc'|'loc'|'item'} field
   * @returns {boolean} True if the event was consumed (caller should not run other handlers).
   */
  const handlePromptMentionKeyDown = (e, field) => {
    const mp = mentionPopupRef.current;
    if (!mp || mp.field !== field || !mp.items?.length) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMentionPopup(null);
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionPopup((prev) =>
        prev && prev.field === field
          ? { ...prev, activeIndex: Math.min(prev.activeIndex + 1, prev.items.length - 1) }
          : prev,
      );
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionPopup((prev) =>
        prev && prev.field === field
          ? { ...prev, activeIndex: Math.max(prev.activeIndex - 1, 0) }
          : prev,
      );
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const cur = mentionPopupRef.current;
      if (cur?.items?.[cur.activeIndex]) applyMentionChoice(cur.items[cur.activeIndex]);
      return true;
    }
    return false;
  };

  /**
   * Handles main note body typing: debounced @mention fetch (world-wide or campaign-only per backend scope).
   * @param {React.ChangeEvent<HTMLTextAreaElement>} e
   */
  const handleMainEditorChange = (e) => {
    const v = e.target.value;
    const cursor = e.target.selectionStart;
    setContent(v);
    markDirty();
    if (!canEdit || !note?.id) return;
    const parsed = parseMentionAtCursor(v, cursor);
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current);
    if (!parsed || parsed.query.trim().length < 3) {
      setMentionPopup(null);
      return;
    }
    mentionDebounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/notes/meta/mention-suggestions', {
          params: { from_note_id: note.id, q: parsed.query.trim() },
        });
        const items = Array.isArray(res.data) ? res.data : [];
        const cur = contentRef.current;
        const curCursor = contentTextareaRef.current?.selectionStart ?? cur.length;
        const again = parseMentionAtCursor(cur, curCursor);
        if (!again || again.query.trim().length < 3) {
          setMentionPopup(null);
          return;
        }
        setMentionPopup({
          items,
          replaceStart: again.replaceStart,
          replaceEnd: again.replaceEnd,
          activeIndex: 0,
          field: 'body',
        });
      } catch {
        setMentionPopup(null);
      }
    }, 220);
  };

  const handleEditorKeyDown = (e) => {
    if (!canEdit) return;
    const ta = e.target;
    const val = ta.value;
    const ss = ta.selectionStart;
    const se = ta.selectionEnd;
    const sel = val.slice(ss, se);
    const meta = e.ctrlKey || e.metaKey;

    const mp = mentionPopupRef.current;
    const isBodyMention = mp && (!mp.field || mp.field === 'body');
    if (isBodyMention && mp.items && mp.items.length > 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionPopup(null);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionPopup((prev) =>
          prev
            ? {
                ...prev,
                activeIndex: Math.min(prev.activeIndex + 1, prev.items.length - 1),
              }
            : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionPopup((prev) =>
          prev
            ? {
                ...prev,
                activeIndex: Math.max(prev.activeIndex - 1, 0),
              }
            : prev
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cur = mentionPopupRef.current;
        if (cur?.items?.[cur.activeIndex]) applyMentionChoice(cur.items[cur.activeIndex]);
        return;
      }
    }

    const wrap = (before, after = before) => {
      e.preventDefault();
      const newVal = val.slice(0, ss) + before + sel + after + val.slice(se);
      setContent(newVal); markDirty();
      requestAnimationFrame(() => {
        ta.selectionStart = ss + before.length;
        ta.selectionEnd   = se + before.length;
        ta.focus();
      });
    };

    const prefixLines = (prefix) => {
      e.preventDefault();
      const lineStart = val.lastIndexOf('\n', ss - 1) + 1;
      const lineEnd   = val.indexOf('\n', se);
      const end       = lineEnd === -1 ? val.length : lineEnd;
      const lines     = val.slice(lineStart, end).split('\n');
      const toggled   = lines.map(l => l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l);
      setContent(val.slice(0, lineStart) + toggled.join('\n') + val.slice(end)); markDirty();
      requestAnimationFrame(() => ta.focus());
    };

    // Tab / Shift+Tab — indent or outdent bullet lines (skip when accepting a body @mention above)
    if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = val.lastIndexOf('\n', ss - 1) + 1;
      const lineEnd   = val.indexOf('\n', se);
      const end       = lineEnd === -1 ? val.length : lineEnd;
      const lines     = val.slice(lineStart, end).split('\n');

      const indented = lines.map(line => {
        if (e.shiftKey) {
          // Outdent: remove up to 2 leading spaces
          return line.startsWith('  ') ? line.slice(2) : line.startsWith(' ') ? line.slice(1) : line;
        } else {
          // Indent: if not a list item yet, make it one; otherwise add 2 spaces
          const isList = /^\s*(-|\*|\d+\.) /.test(line);
          return isList ? '  ' + line : '- ' + line;
        }
      });

      const newVal = val.slice(0, lineStart) + indented.join('\n') + val.slice(end);
      const cursorShift = e.shiftKey
        ? -Math.min(2, lines[0].match(/^  /) ? 2 : lines[0].match(/^ /) ? 1 : 0)
        : (lines[0].match(/^\s*(-|\*|\d+\.) /) ? 2 : 2);
      setContent(newVal); markDirty();
      requestAnimationFrame(() => {
        ta.selectionStart = Math.max(lineStart, ss + cursorShift);
        ta.selectionEnd   = Math.max(lineStart, se + cursorShift);
        ta.focus();
      });
      return;
    }

    // Enter — continue bullet/numbered list on next line, or break out on empty bullet
    if (e.key === 'Enter') {
      const lineStart  = val.lastIndexOf('\n', ss - 1) + 1;
      const currentLine = val.slice(lineStart, ss);
      const bulletMatch = currentLine.match(/^(\s*)(- \[[ x]\] |- |\* |\d+\. )/);
      if (bulletMatch) {
        e.preventDefault();
        const indent = bulletMatch[1];
        const marker = bulletMatch[2];
        const lineContent = currentLine.slice(indent.length + marker.length);
        if (!lineContent.trim()) {
          // Empty bullet — break out: remove the prefix
          const newVal = val.slice(0, lineStart) + indent + val.slice(ss);
          setContent(newVal); markDirty();
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = lineStart + indent.length;
            ta.focus();
          });
        } else {
          // Continue the list
          const nextMarker = marker.match(/^(\d+)\. /)
            ? (parseInt(marker) + 1) + '. '
            : marker.replace(/\[[ x]\] /, '[ ] '); // reset checkbox
          const insertion = '\n' + indent + nextMarker;
          const newVal = val.slice(0, ss) + insertion + val.slice(se);
          setContent(newVal); markDirty();
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = ss + insertion.length;
            ta.focus();
          });
        }
        return;
      }
    }

    if (!meta) return;
    if (e.key === 'b' || e.key === 'B') return wrap('**');
    if (e.key === 'i' || e.key === 'I') return wrap('*');
    if (e.key === '`')                   return wrap('`');
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      const link = '[' + (sel || 'text') + '](url)';
      const newVal = val.slice(0, ss) + link + val.slice(se);
      setContent(newVal); markDirty();
      requestAnimationFrame(() => {
        const urlStart = ss + (sel || 'text').length + 3;
        ta.selectionStart = urlStart; ta.selectionEnd = urlStart + 3; ta.focus();
      });
      return;
    }
    if (e.shiftKey) {
      if (e.key === 'X' || e.key === 'x') return wrap('~~');
      if (e.key === '.' || e.key === '>')  return prefixLines('> ');
      if (e.key === 'U' || e.key === 'u')  return prefixLines('- ');
      if (e.key === '1' || e.key === '!')   return prefixLines('# ');
      if (e.key === '2' || e.key === '@')   return prefixLines('## ');
      if (e.key === '3' || e.key === '#')   return prefixLines('### ');
    }
  };

  /** Banner when this note was branched from another note (source_note_id) or the source is gone. */
  const showSourceNoteCallout =
    !!note && !note.is_folder && (note.source_deleted || note.source_note_id);

  return (
    <div style={S.wrap}>
      {showMove && (
        <MoveModal
          note={note}
          notes={notes}
          onMove={async (newParentId) => {
            await onSave({ parent_id: newParentId === undefined ? note.parent_id : newParentId });
            setShowMove(false);
          }}
          onClose={() => setShowMove(false)}
        />
      )}
      <div style={S.mainScroll}>
      <div style={S.header}>
        {showSourceNoteCallout && (
          <div
            style={{
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: '4px',
              border: '1px solid rgba(200,148,58,0.2)',
              background: 'rgba(200,148,58,0.06)',
              fontFamily: 'Crimson Pro, serif',
              fontSize: '13px',
              color: 'rgba(226,213,187,0.75)',
              lineHeight: 1.45,
            }}
          >
            {!!note?.source_deleted && (
              <div style={{ marginBottom: note?.source_note_id ? '8px' : 0, color: 'rgba(224,160,112,0.95)' }}>
                The original note this entry was based on is missing or in trash. You can still edit this copy.
              </div>
            )}
            {!!note?.source_note_id && (
              <div>
                This note was branched from another entry. Edits here do not change the source note.
                {typeof onOpenReferenceNote === 'function' && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => onOpenReferenceNote(note.source_note_id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#c8943a',
                        textDecoration: 'underline',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        padding: 0,
                      }}
                    >
                      Open source note
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {underArchive && !isAdminUser && (
          <div
            style={{
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: '4px',
              border: '1px solid rgba(200,148,58,0.28)',
              background: 'rgba(200,148,58,0.07)',
              fontFamily: 'Crimson Pro, serif',
              fontSize: '13px',
              color: 'rgba(226,213,187,0.82)',
              lineHeight: 1.45,
            }}
          >
            This campaign or world is marked <strong style={{ color: '#c8943a' }}>completed</strong>. Notes and journal are read-only. A DM can clear completion on the world or campaign root folder.
          </div>
        )}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', marginLeft: '-8px' }}>
            <button
              onClick={onBackToList}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c8943a', fontSize: '22px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              title="Back to notes"
            >←</button>
            <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)' }}>NOTES</span>
          </div>
        )}
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' } : S.titleRow}>
          <input
            ref={titleInputRef}
            style={S.titleInput}
            value={title}
            onChange={(e) => { setTitle(e.target.value); markDirty(); }}
            placeholder="Note title..."
            disabled={!canEdit}
          />
          {canManageUi && (
            <div style={isMobile ? { display: 'flex', gap: '8px', flexWrap: 'wrap' } : { display: 'contents' }}>
              {isMobile && (
                <button
                  style={{ ...S.saveBtn(false), marginLeft: 0, color: 'rgba(200,148,58,0.7)', borderColor: 'rgba(200,148,58,0.2)', flexShrink: 0, minHeight: '40px', padding: '8px 16px' }}
                  onClick={() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }}
                  title="Rename this note"
                >
                  Rename
                </button>
              )}
              <button
                style={{ ...S.saveBtn(false), marginLeft: 0, color: 'rgba(200,148,58,0.7)', borderColor: 'rgba(200,148,58,0.35)', flexShrink: 0, ...(isMobile ? { minHeight: '40px', padding: '8px 16px' } : {}) }}
                onClick={() => setShowMove(true)}
                title="Move to a different folder"
              >
                Move
              </button>
              <button
                style={{ ...S.saveBtn(false), marginLeft: 0, color: 'rgba(224,112,112,0.75)', borderColor: 'rgba(224,112,112,0.3)', flexShrink: 0, ...(isMobile ? { minHeight: '40px', padding: '8px 16px' } : {}) }}
                onClick={() => onDelete(note.id, note.title, !!note?.is_folder)}
                title="Delete this note"
              >
                Delete
              </button>
              {!!note?.recovered && (
                <button
                  style={{ ...S.saveBtn(false), marginLeft: 0, color: 'rgba(139,196,226,0.5)', borderColor: 'rgba(139,196,226,0.2)', flexShrink: 0, ...(isMobile ? { minHeight: '40px', padding: '8px 16px' } : {}) }}
                  onClick={async () => {
                    await api.put(`/notes/${note.id}/clear-recovered`);
                    onSave(null);
                  }}
                  title="Remove the (Recovered) label and mark as original"
                >
                  ↩ Clear Recovered
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ ...S.metaRow, WebkitOverflowScrolling: 'touch' }} className="toolbar-scroll">
          {!note?.is_folder && <select
            style={{ ...S.select, borderColor: `${getCategoryColor(category)}50`, color: getCategoryColor(category), ...(isMobile ? { minHeight: '44px', fontSize: '14px' } : {}) }}
            value={category}
            onChange={(e) => { setCategory(e.target.value); markDirty(); }}
            disabled={!canEdit}
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>}

          {/* Significance tier */}
          {!note?.is_folder && <select
            style={{ ...S.select, maxWidth: '120px',
              borderColor: significance === 'major' ? 'rgba(200,148,58,0.5)' : significance === 'minor' ? 'rgba(100,100,100,0.4)' : 'rgba(226,213,187,0.15)',
              color: significance === 'major' ? '#c8943a' : significance === 'minor' ? 'rgba(226,213,187,0.35)' : 'rgba(226,213,187,0.55)',
            }}
            value={significance}
            onChange={(e) => { setSignificance(e.target.value); markDirty(); }}
            disabled={!canEdit}
            title="Node significance — affects size in graph view"
          >
            <option value="major">★ Major</option>
            <option value="standard">◆ Standard</option>
            <option value="minor">◇ Minor</option>
          </select>}

          {/* Narrative weight */}
          {!note?.is_folder && <select
            style={{ ...S.select, maxWidth: '130px',
              borderColor: narrativeWeight === 'landmark' ? 'rgba(139,196,226,0.5)' : narrativeWeight === 'detail' ? 'rgba(100,100,100,0.3)' : 'rgba(226,213,187,0.15)',
              color: narrativeWeight === 'landmark' ? 'rgba(139,196,226,0.85)' : narrativeWeight === 'detail' ? 'rgba(226,213,187,0.3)' : 'rgba(226,213,187,0.55)',
            }}
            value={narrativeWeight}
            onChange={(e) => { setNarrativeWeight(e.target.value); markDirty(); }}
            disabled={!canEdit}
            title="Narrative weight — affects graph rendering"
          >
            <option value="landmark">⬡ Landmark</option>
            <option value="node">● Node</option>
            <option value="detail">○ Detail</option>
          </select>}

          {/* Note sidebar icon — toolbar button opens modal (all icons + themed suggestions); no preset → category default in tree */}
          {!note?.is_folder && canEdit && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }} title="Sidebar icon">
                <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.35)' }}>ICON</span>
                <button
                  type="button"
                  onClick={() => setNoteIconMenuOpen(true)}
                  title={!displayIcon ? 'Using category default — click to choose an icon' : 'Change sidebar icon'}
                  style={{
                    width: '30px', height: '30px', borderRadius: '4px', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px ${!displayIcon ? 'dashed' : 'solid'} rgba(200,148,58,${!displayIcon ? '0.35' : '0.2'})`,
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  {isManagedSidebarIconUrl(displayIcon) ? (
                    <img src={displayIcon} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3 }} />
                  ) : (
                    <span style={{ fontSize: '17px', lineHeight: 1 }}>{displayIcon || defaultNoteIconEmoji(category)}</span>
                  )}
                </button>
                {isDM && (
                  <>
                    <input
                      ref={sidebarIconInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleSidebarIconFile}
                    />
                    <button
                      type="button"
                      onClick={() => sidebarIconInputRef.current?.click()}
                      disabled={uploadingSidebarIcon}
                      title="Upload a small image (DM / admin, max 512KB)"
                      style={{
                        width: '28px', height: '28px', fontSize: '14px', borderRadius: '4px', cursor: uploadingSidebarIcon ? 'wait' : 'pointer',
                        border: `1px solid ${isManagedSidebarIconUrl(displayIcon) ? 'rgba(200,148,58,0.55)' : 'rgba(255,255,255,0.08)'}`,
                        background: isManagedSidebarIconUrl(displayIcon) ? 'rgba(200,148,58,0.15)' : 'transparent',
                        flexShrink: 0,
                      }}
                    >{uploadingSidebarIcon ? '…' : '🖼'}</button>
                  </>
                )}
              </div>
              {noteIconMenuOpen && createPortal(
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Choose sidebar icon"
                  style={{
                    position: 'fixed', inset: 0, zIndex: 4000,
                    background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
                  }}
                  onClick={() => setNoteIconMenuOpen(false)}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%', maxWidth: '440px', maxHeight: '88vh', overflow: 'auto',
                      background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
                      border: '1px solid rgba(200,148,58,0.35)', borderRadius: '6px',
                      padding: '16px 18px 18px', boxShadow: '0 24px 90px rgba(0,0,0,0.92)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.18em', color: '#c8943a' }}>SIDEBAR ICON</span>
                      <button
                        type="button"
                        onClick={() => setNoteIconMenuOpen(false)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.35)', fontSize: '22px', lineHeight: 1, padding: '0 4px',
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.42)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      Themed groups match note categories, but you can choose <strong style={{ color: 'rgba(226,213,187,0.58)' }}>any</strong> icon. This note is <strong style={{ color: 'rgba(226,213,187,0.58)' }}>{CATEGORIES.find((c) => c.value === category)?.label || 'General'}</strong>.
                    </p>
                    <button
                      type="button"
                      onClick={() => persistNoteDisplayIcon(null)}
                      style={{
                        width: '100%', marginBottom: '14px', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer',
                        fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
                        border: '1px solid rgba(200,148,58,0.3)', background: 'rgba(200,148,58,0.08)', color: 'rgba(200,148,58,0.85)',
                      }}
                    >
                      USE CATEGORY DEFAULT ({defaultNoteIconEmoji(category)})
                    </button>
                    <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.14em', color: 'rgba(226,213,187,0.35)', marginBottom: '8px' }}>ALL ICONS</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
                      {uniqueNotePresetIcons.map((ic, idx) => (
                        <button
                          key={`all-${idx}`}
                          type="button"
                          onClick={() => persistNoteDisplayIcon(ic)}
                          style={{
                            width: '34px', height: '34px', fontSize: '18px', borderRadius: '4px', cursor: 'pointer',
                            border: `1px solid ${displayIcon === ic ? 'rgba(200,148,58,0.55)' : 'rgba(255,255,255,0.1)'}`,
                            background: displayIcon === ic ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.03)',
                          }}
                        >{ic}</button>
                      ))}
                    </div>
                    <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.14em', color: 'rgba(226,213,187,0.35)', marginBottom: '8px' }}>SUGGESTIONS BY THEME</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {NOTE_ICON_CATEGORIES.map(({ categoryKey, label, icons }) => (
                        <div key={categoryKey}>
                          <div
                            style={{
                              fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em',
                              color: category === categoryKey ? 'rgba(200,148,58,0.6)' : 'rgba(226,213,187,0.28)',
                              marginBottom: '6px',
                            }}
                          >
                            {label}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {icons.map((ic, idx) => (
                              <button
                                key={`${categoryKey}-${idx}`}
                                type="button"
                                onClick={() => persistNoteDisplayIcon(ic)}
                                style={{
                                  width: '34px', height: '34px', fontSize: '18px', borderRadius: '4px', cursor: 'pointer',
                                  border: `1px solid ${displayIcon === ic ? 'rgba(200,148,58,0.55)' : 'rgba(255,255,255,0.1)'}`,
                                  background: displayIcon === ic ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.03)',
                                }}
                              >{ic}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </>
          )}

          {/* DM Only badge — visible in toolbar when flag is set */}
          {isDmOnly && (
            <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.8)', padding: '4px 8px', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', background: 'rgba(200,148,58,0.08)', flexShrink: 0 }}>⚔ DM ONLY</span>
          )}

          {/* Permissions button — owner or admin can manage */}
          {canManageUi && (
            <button
              style={{ ...S.toggleShared(noteVisibility === 'shared'), position: 'relative' }}
              onClick={() => { setDrawerTab('permissions'); setDrawerOpen(true); }}
              title="Manage access"
            >
              {noteVisibility === 'shared' ? '⚔ Party Shared' : '🔒 Hidden'}
              {grantedUsers.length > 0 && noteVisibility === 'hidden' && (
                <span style={{ marginLeft: '5px', fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.6)' }}>+{grantedUsers.length}</span>
              )}
            </button>
          )}
          {!canManage && !canFullEdit && !canAppend && (
            <span style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.25)', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '3px' }}>
              {note?.visibility === 'shared' ? '⚔ Shared' : '👁 Granted'}
            </span>
          )}

          {/* Who can see this — eyeball hover tooltip */}
          <WhoCanSee note={note} allUsers={allUsers} currentUser={currentUser} />

          {/* Undo / Redo */}
          {canEdit && (
            <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
              <button
                onClick={handleUndo}
                disabled={undoStack.current.length === 0}
                title="Undo (Ctrl+Z)"
                style={{ ...S.viewBtn(false), opacity: undoStack.current.length === 0 ? 0.25 : 0.7, fontSize: '13px', padding: '3px 7px' }}
              >↩</button>
              <button
                onClick={handleRedo}
                disabled={redoStack.current.length === 0}
                title="Redo (Ctrl+Shift+Z)"
                style={{ ...S.viewBtn(false), opacity: redoStack.current.length === 0 ? 0.25 : 0.7, fontSize: '13px', padding: '3px 7px' }}
              >↪</button>
            </div>
          )}

          <div style={S.viewToggle}>
            <button style={S.viewBtn(viewMode === 'view')} onClick={() => setAndPersistViewMode('view')}>View</button>
            <button style={S.viewBtn(viewMode === 'edit')} onClick={() => setAndPersistViewMode('edit')}>Edit</button>
          </div>
          <button
            onClick={() => setShowMdHelp(v => !v)}
            style={{ ...S.viewBtn(showMdHelp), marginLeft: '2px', fontSize: '11px', padding: '4px 8px' }}
            title="Markdown reference"
          >?</button>

          {canEdit && dirty && (
            <button style={S.saveBtn(true)} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}

          {canEdit && !dirty && savedAt && (
            <span style={{ marginLeft: 'auto', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(58,196,139,0.4)' }}>
              ✓ Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}

        </div>

        {/* Player lore summary — gated on completed campaign/world (server + underArchive). */}
        {!note?.is_folder && underArchive && !!aiAdminStatus.ai_enabled && (!note?.is_dm_only || isDM || isAdminUser) && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.45)', marginBottom: '8px' }}>
              LORE SUMMARY (AI)
            </div>
            <button
              type="button"
              onClick={handlePlayerSummarize}
              disabled={summarizeBusy}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: summarizeBusy ? 'wait' : 'pointer',
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.12em',
                border: '1px solid rgba(139,196,226,0.45)',
                background: 'rgba(139,196,226,0.1)',
                color: 'rgba(200,220,240,0.95)',
                marginBottom: summarizeErr || summarizeText ? '10px' : 0,
              }}
            >
              {summarizeBusy ? 'Summarizing…' : 'Summarize (AI)'}
            </button>
            {summarizeErr && (
              <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', marginBottom: '8px' }}>{summarizeErr}</div>
            )}
            {summarizeText && (
              <div
                style={{
                  fontFamily: 'Crimson Pro, serif',
                  fontSize: '14px',
                  lineHeight: 1.65,
                  color: 'rgba(226,213,187,0.88)',
                  padding: '12px 14px',
                  borderRadius: '4px',
                  border: '1px solid rgba(200,148,58,0.2)',
                  background: 'rgba(0,0,0,0.2)',
                  maxWidth: '640px',
                }}
              >
                {summarizeText}
              </div>
            )}
          </div>
        )}

        {/* Mark world/campaign complete — DM/admin on scope root only (above Chronicle so it stays visible). */}
        {canToggleCompletion && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.42)', margin: '0 0 10px', lineHeight: 1.45 }}>
              Select the <strong style={{ color: 'rgba(226,213,187,0.65)' }}>world or campaign root</strong> folder in the sidebar (not a subfolder). This archives the campaign for players until you clear it.
            </p>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: completionBusy ? 'wait' : 'pointer',
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: note?.is_completed ? 'rgba(200,148,58,0.9)' : 'rgba(226,213,187,0.65)',
              }}
            >
              <input
                type="checkbox"
                checked={!!note?.is_completed}
                disabled={completionBusy}
                onChange={(e) => handleCompletionToggle(e.target.checked)}
              />
              Mark {folderTreeKind === 'world' ? 'world' : 'campaign'} as completed (archives subtree — read-only for players)
            </label>
            {completionToggleErr && (
              <div
                style={{
                  fontFamily: 'Crimson Pro, serif',
                  fontSize: '13px',
                  color: 'rgba(224,112,112,0.95)',
                  marginTop: '8px',
                }}
              >
                {completionToggleErr}
              </div>
            )}
          </div>
        )}

        {/* Folder appearance: icon palette by world / campaign / subfolder + sidebar blurb */}
        {canFolderStyle && canEditContent && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={S.connLabel}>CHRONICLE APPEARANCE</div>
            <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.38)', margin: '0 0 10px', lineHeight: 1.45 }}>
              Choose an icon and short description for the sidebar. Worlds use cosmic symbols; campaigns use adventure motifs; nested folders use organizer icons.
              {isDM && ' DMs and admins can upload a small image for the sidebar (max 512KB); the server enforces size limits.'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={async () => {
                  setDisplayIcon('');
                  try {
                    const res = await api.put(`/notes/${note.id}`, { client_updated_at: serverUpdatedAt.current, display_icon: null, display_summary: displaySummaryRef.current === '' ? null : displaySummaryRef.current });
                    serverUpdatedAt.current = res.data?.updated_at || serverUpdatedAt.current;
                    if (onSave) onSave(res.data);
                  } catch (e) { console.error(e); }
                }}
                style={{
                  minWidth: '40px', height: '40px', fontSize: '11px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'Cinzel',
                  border: `1px solid ${!displayIcon ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.1)'}`, background: !displayIcon ? 'rgba(200,148,58,0.12)' : 'transparent', color: 'rgba(226,213,187,0.5)',
                }}
                title="Automatic default for this folder type"
              >AUTO</button>
              {iconChoicesForFolderKind(folderTreeKind).map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={async () => {
                    setDisplayIcon(ic);
                    try {
                      const res = await api.put(`/notes/${note.id}`, { client_updated_at: serverUpdatedAt.current, display_icon: ic, display_summary: displaySummaryRef.current === '' ? null : displaySummaryRef.current });
                      serverUpdatedAt.current = res.data?.updated_at || serverUpdatedAt.current;
                      if (onSave) onSave(res.data);
                    } catch (e) { console.error(e); }
                  }}
                  style={{
                    width: '40px', height: '40px', fontSize: '20px', borderRadius: '6px', cursor: 'pointer',
                    border: `1px solid ${displayIcon === ic ? 'rgba(200,148,58,0.55)' : 'rgba(255,255,255,0.08)'}`, background: displayIcon === ic ? 'rgba(200,148,58,0.18)' : 'rgba(255,255,255,0.02)',
                  }}
                >{ic}</button>
              ))}
            </div>
            {isDM && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <input
                    ref={sidebarIconInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleSidebarIconFile}
                  />
                  <button
                    type="button"
                    onClick={() => sidebarIconInputRef.current?.click()}
                    disabled={uploadingSidebarIcon}
                    style={{
                      fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '8px 14px', cursor: uploadingSidebarIcon ? 'wait' : 'pointer',
                      border: '1px solid rgba(200,148,58,0.35)', borderRadius: '4px', background: 'rgba(200,148,58,0.08)', color: 'rgba(226,213,187,0.75)',
                    }}
                  >
                    {uploadingSidebarIcon ? 'Uploading…' : 'Upload image icon'}
                  </button>
                  {isManagedSidebarIconUrl(displayIcon) && (
                    <img
                      src={displayIcon}
                      alt=""
                      style={{
                        width: 40, height: 40, objectFit: 'cover', borderRadius: 6,
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}
                    />
                  )}
                </div>
              </div>
            )}
            <label style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.45)', display: 'block', marginBottom: '6px' }}>SIDEBAR DESCRIPTION</label>
            <textarea
              value={displaySummary}
              onChange={(e) => { setDisplaySummary(e.target.value); markDirty(); }}
              placeholder="One or two lines shown in the sidebar tooltip (optional)…"
              disabled={!canEdit}
              rows={3}
              style={{
                width: '100%', maxWidth: '560px', boxSizing: 'border-box', resize: 'vertical',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', padding: '10px 12px', outline: 'none',
              }}
            />
          </div>
        )}

        {/* DM AI Tools — only on world or campaign root folders (not nested organizers) */}
        {note?.is_folder && isDM && continuityFolderId && dmAiRootOnly && (!underArchive || isAdminUser) && (
          <div style={{
            marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(139,196,226,0.12)',
          }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.2em', color: 'rgba(139,196,226,0.65)', marginBottom: '6px' }}>
              DM AI TOOLS
            </div>
            <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.38)', margin: '0 0 14px', lineHeight: 1.45 }}>
              Select a <strong style={{ color: 'rgba(226,213,187,0.55)' }}>world</strong> or <strong style={{ color: 'rgba(226,213,187,0.55)' }}>campaign</strong> folder to use generators. In each prompt, paste <strong style={{ color: 'rgba(226,213,187,0.55)' }}>[Title](note:id)</strong> links (from @mentions in notes) or <strong style={{ color: 'rgba(226,213,187,0.55)' }}>note:123</strong> so the AI can use those notes as context.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.45)', marginBottom: '8px' }}>
                NPC / CHARACTER
              </div>
              <textarea
                ref={npcPromptTextareaRef}
                value={npcPrompt}
                onChange={(e) => {
                  const v = e.target.value;
                  const cursor = e.target.selectionStart;
                  setNpcPrompt(v);
                  npcPromptRef.current = v;
                  schedulePromptMention('npc', v, cursor);
                }}
                onKeyDown={(e) => {
                  if (handlePromptMentionKeyDown(e, 'npc')) return;
                }}
                placeholder="NPC-only: role, voice, goals… Type @ for links or paste [Title](note:id)."
                rows={4}
                disabled={!aiAdminStatus.ai_enabled}
                spellCheck={false}
                style={{
                  width: '100%', maxWidth: '560px', boxSizing: 'border-box', resize: 'vertical',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                  color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', padding: '10px 12px', outline: 'none',
                  marginBottom: '10px', opacity: aiAdminStatus.ai_enabled ? 1 : 0.5,
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.55)' }}>
                  Folder
                  <select
                    value={npcParentId ?? ''}
                    onChange={(e) => setNpcParentId(parseInt(e.target.value, 10) || null)}
                    style={{
                      minWidth: '180px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '3px', color: '#e2d5bb', fontSize: '13px', fontFamily: 'Crimson Pro, serif', padding: '6px 10px', outline: 'none',
                    }}
                  >
                    <option value={continuityFolderId}>
                      {(notes || []).find((n) => n.id === continuityFolderId)?.title || 'Campaign / world root'}
                    </option>
                    {descendantFolders.map((f) => (
                      <option key={f.id} value={f.id}>{f.title}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: npcDmOnly ? 'rgba(200,148,58,0.85)' : 'rgba(226,213,187,0.45)' }}>
                  <input
                    type="checkbox"
                    checked={npcDmOnly}
                    onChange={(e) => setNpcDmOnly(e.target.checked)}
                  />
                  DM-only note
                </label>
              </div>
              {npcErr && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', marginBottom: '8px' }}>{npcErr}</div>
              )}
              <button
                type="button"
                onClick={handleNpcGenerate}
                disabled={npcBusy || !aiAdminStatus.ai_enabled || !npcPrompt.trim()}
                style={{
                  padding: '8px 16px', borderRadius: '4px', cursor: npcBusy || !aiAdminStatus.ai_enabled ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.14em',
                  border: `1px solid ${!aiAdminStatus.ai_enabled ? 'rgba(255,255,255,0.08)' : 'rgba(139,196,226,0.4)'}`,
                  background: !aiAdminStatus.ai_enabled ? 'transparent' : 'rgba(139,196,226,0.12)',
                  color: !aiAdminStatus.ai_enabled ? 'rgba(226,213,187,0.25)' : 'rgba(139,196,226,0.95)',
                }}
              >
                {npcBusy ? 'Generating…' : 'Create NPC note'}
              </button>
            </div>

            <div style={{ marginBottom: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(58,196,139,0.45)', marginBottom: '8px' }}>
                LOCATION
              </div>
              <textarea
                ref={locPromptTextareaRef}
                value={locPrompt}
                onChange={(e) => {
                  const v = e.target.value;
                  const cursor = e.target.selectionStart;
                  setLocPrompt(v);
                  locPromptRef.current = v;
                  schedulePromptMention('loc', v, cursor);
                }}
                onKeyDown={(e) => {
                  if (handlePromptMentionKeyDown(e, 'loc')) return;
                }}
                placeholder="Place-only: settlement, dungeon, region… Type @ or use [Title](note:id) for canon ties."
                rows={4}
                disabled={!aiAdminStatus.ai_enabled}
                spellCheck={false}
                style={{
                  width: '100%', maxWidth: '560px', boxSizing: 'border-box', resize: 'vertical',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                  color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', padding: '10px 12px', outline: 'none',
                  marginBottom: '10px', opacity: aiAdminStatus.ai_enabled ? 1 : 0.5,
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.55)' }}>
                  Folder
                  <select
                    value={locParentId ?? ''}
                    onChange={(e) => setLocParentId(parseInt(e.target.value, 10) || null)}
                    style={{
                      minWidth: '180px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '3px', color: '#e2d5bb', fontSize: '13px', fontFamily: 'Crimson Pro, serif', padding: '6px 10px', outline: 'none',
                    }}
                  >
                    <option value={continuityFolderId}>
                      {(notes || []).find((n) => n.id === continuityFolderId)?.title || 'Campaign / world root'}
                    </option>
                    {descendantFolders.map((f) => (
                      <option key={`loc-${f.id}`} value={f.id}>{f.title}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: locDmOnly ? 'rgba(200,148,58,0.85)' : 'rgba(226,213,187,0.45)' }}>
                  <input type="checkbox" checked={locDmOnly} onChange={(e) => setLocDmOnly(e.target.checked)} />
                  DM-only note
                </label>
              </div>
              {locErr && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', marginBottom: '8px' }}>{locErr}</div>
              )}
              <button
                type="button"
                onClick={handleLocationGenerate}
                disabled={locBusy || !aiAdminStatus.ai_enabled || !locPrompt.trim()}
                style={{
                  padding: '8px 16px', borderRadius: '4px', cursor: locBusy || !aiAdminStatus.ai_enabled ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.14em',
                  border: `1px solid ${!aiAdminStatus.ai_enabled ? 'rgba(255,255,255,0.08)' : 'rgba(58,196,139,0.4)'}`,
                  background: !aiAdminStatus.ai_enabled ? 'transparent' : 'rgba(58,196,139,0.1)',
                  color: !aiAdminStatus.ai_enabled ? 'rgba(226,213,187,0.25)' : 'rgba(58,196,139,0.95)',
                }}
              >
                {locBusy ? 'Generating…' : 'Create location note'}
              </button>
            </div>

            <div style={{ marginBottom: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(107,58,196,0.55)', marginBottom: '8px' }}>
                ITEM / ARTIFACT
              </div>
              <textarea
                ref={itemPromptTextareaRef}
                value={itemPrompt}
                onChange={(e) => {
                  const v = e.target.value;
                  const cursor = e.target.selectionStart;
                  setItemPrompt(v);
                  itemPromptRef.current = v;
                  schedulePromptMention('item', v, cursor);
                }}
                onKeyDown={(e) => {
                  if (handlePromptMentionKeyDown(e, 'item')) return;
                }}
                placeholder="Object-only: weapon, relic, consumable… Type @ or link notes with [Title](note:id)."
                rows={4}
                disabled={!aiAdminStatus.ai_enabled}
                spellCheck={false}
                style={{
                  width: '100%', maxWidth: '560px', boxSizing: 'border-box', resize: 'vertical',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                  color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', padding: '10px 12px', outline: 'none',
                  marginBottom: '10px', opacity: aiAdminStatus.ai_enabled ? 1 : 0.5,
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: 'rgba(226,213,187,0.55)' }}>
                  Folder
                  <select
                    value={itemParentId ?? ''}
                    onChange={(e) => setItemParentId(parseInt(e.target.value, 10) || null)}
                    style={{
                      minWidth: '180px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '3px', color: '#e2d5bb', fontSize: '13px', fontFamily: 'Crimson Pro, serif', padding: '6px 10px', outline: 'none',
                    }}
                  >
                    <option value={continuityFolderId}>
                      {(notes || []).find((n) => n.id === continuityFolderId)?.title || 'Campaign / world root'}
                    </option>
                    {descendantFolders.map((f) => (
                      <option key={`item-${f.id}`} value={f.id}>{f.title}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em', color: itemDmOnly ? 'rgba(200,148,58,0.85)' : 'rgba(226,213,187,0.45)' }}>
                  <input type="checkbox" checked={itemDmOnly} onChange={(e) => setItemDmOnly(e.target.checked)} />
                  DM-only note
                </label>
              </div>
              {itemErr && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', marginBottom: '8px' }}>{itemErr}</div>
              )}
              <button
                type="button"
                onClick={handleItemGenerate}
                disabled={itemBusy || !aiAdminStatus.ai_enabled || !itemPrompt.trim()}
                style={{
                  padding: '8px 16px', borderRadius: '4px', cursor: itemBusy || !aiAdminStatus.ai_enabled ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.14em',
                  border: `1px solid ${!aiAdminStatus.ai_enabled ? 'rgba(255,255,255,0.08)' : 'rgba(107,58,196,0.45)'}`,
                  background: !aiAdminStatus.ai_enabled ? 'transparent' : 'rgba(107,58,196,0.12)',
                  color: !aiAdminStatus.ai_enabled ? 'rgba(226,213,187,0.25)' : 'rgba(200,180,240,0.95)',
                }}
              >
                {itemBusy ? 'Generating…' : 'Create item note'}
              </button>
            </div>

            <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.45)', marginBottom: '6px' }}>
                CONTINUITY CHECKER
              </div>
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.42)', margin: '0 0 10px', lineHeight: 1.45 }}>
                Runs only on this world/campaign root. Builds a visibility-safe corpus, then writes or updates a DM-only note titled <strong style={{ color: 'rgba(226,213,187,0.65)' }}>AI Continuity Report</strong> under{' '}
                <strong style={{ color: 'rgba(226,213,187,0.65)' }}>{(notes || []).find((n) => n.id === continuityFolderId)?.title || 'this folder'}</strong>.
              </p>
              {contErr && (
                <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(224,112,112,0.9)', marginBottom: '8px' }}>{contErr}</div>
              )}
              <button
                type="button"
                onClick={handleContinuityGenerate}
                disabled={contBusy || !aiAdminStatus.ai_enabled}
                style={{
                  padding: '8px 16px', borderRadius: '4px', cursor: contBusy || !aiAdminStatus.ai_enabled ? 'default' : 'pointer',
                  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.14em',
                  border: `1px solid ${!aiAdminStatus.ai_enabled ? 'rgba(255,255,255,0.08)' : 'rgba(200,148,58,0.35)'}`,
                  background: !aiAdminStatus.ai_enabled ? 'transparent' : 'rgba(200,148,58,0.1)',
                  color: !aiAdminStatus.ai_enabled ? 'rgba(226,213,187,0.25)' : '#c8943a',
                }}
              >
                {contBusy ? 'Analyzing…' : 'Generate / update continuity report'}
              </button>
            </div>

            {!aiAdminStatus.ai_enabled && (
              <p style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.35)', margin: '14px 0 0' }}>
                Enable AI in Admin → AI to use these tools.
              </p>
            )}
          </div>
        )}

        {/* Optional sidebar blurb for notes (same column as folders; icon row is in toolbar) */}
        {!note?.is_folder && canEdit && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <label style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.45)', display: 'block', marginBottom: '6px' }}>SIDEBAR DESCRIPTION</label>
            <textarea
              value={displaySummary}
              onChange={(e) => { setDisplaySummary(e.target.value); markDirty(); }}
              placeholder="Optional — appears under the title when hovering in the note list…"
              rows={2}
              style={{
                width: '100%', maxWidth: '560px', boxSizing: 'border-box', resize: 'vertical',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
                color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif', padding: '8px 12px', outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      <div style={{ ...S.body, ...S.bodyInScroll }}>
        {viewMode === 'edit' ? (
          <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <textarea
              ref={contentTextareaRef}
              style={S.editor}
              value={content}
              onChange={handleMainEditorChange}
              onKeyDown={handleEditorKeyDown}
              placeholder={
                canEdit
                  ? 'Write your notes here... Markdown is supported. Type @ then a few characters (or a multi-word title); under a world, search includes all campaigns in that world.'
                  : canAppend
                    ? 'This note belongs to another party member. You can append a DM addition below.'
                    : 'This is a read-only shared note.'
              }
              readOnly={!canEdit}
              spellCheck={false}
            />
            {mentionPopup && (!mentionPopup.field || mentionPopup.field === 'body') && mentionPopup.items && mentionPopup.items.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 10,
                  right: 10,
                  bottom: 10,
                  maxHeight: 'min(200px, 40vh)',
                  overflowY: 'auto',
                  background: '#12151c',
                  border: '1px solid rgba(200,148,58,0.35)',
                  borderRadius: '4px',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
                  zIndex: 30,
                }}
              >
                <div
                  style={{
                    fontFamily: 'Cinzel',
                    fontSize: '7px',
                    letterSpacing: '0.12em',
                    color: 'rgba(200,148,58,0.45)',
                    padding: '6px 10px 4px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  @ LINKS (WORLD OR CAMPAIGN SCOPE) — ↑↓ ENTER TAB
                </div>
                {mentionPopup.items.map((it, idx) => (
                  <button
                    key={it.id}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => applyMentionChoice(it)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      borderLeft: `3px solid ${getCategoryColor(it.category)}`,
                      background:
                        idx === mentionPopup.activeIndex ? 'rgba(200,148,58,0.12)' : 'transparent',
                      color: '#e2d5bb',
                      fontFamily: 'Crimson Pro, serif',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {it.title}
                    </span>
                    <span
                      style={{
                        fontFamily: 'Cinzel',
                        fontSize: '7px',
                        letterSpacing: '0.06em',
                        color: 'rgba(226,213,187,0.35)',
                        flexShrink: 0,
                      }}
                    >
                      {it.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={S.preview} className="md-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={chroniclerUrlTransform}
              components={{
                a: ({ href, children }) => {
                  const h = href != null ? String(href).trim() : '';
                  if (h && /^note:\d+$/i.test(h)) {
                    const nid = parseInt(h.replace(/^note:/i, ''), 10);
                    return (
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: onOpenReferenceNote ? 'pointer' : 'default',
                          color: '#c8943a',
                          textDecoration: 'underline',
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                          padding: 0,
                        }}
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          if (onOpenReferenceNote) onOpenReferenceNote(nid);
                        }}
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#c8943a' }}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content || '*No content yet.*'}
            </ReactMarkdown>
            <style>{`
              .md-content img { max-width: 100%; height: auto; border-radius: 4px; display: block; margin: 8px 0; }
              .md-content h1, .md-content h2, .md-content h3 { font-family: 'Cinzel', serif; color: #c8943a; margin: 16px 0 6px; }
              .md-content p { margin: 0 0 10px; }
              .md-content ul, .md-content ol { padding-left: 20px; margin: 0 0 10px; }
              .md-content blockquote { border-left: 2px solid rgba(200,148,58,0.3); margin: 0 0 10px; padding: 4px 12px; color: rgba(226,213,187,0.6); font-style: italic; }
              .md-content code { background: rgba(255,255,255,0.06); border-radius: 2px; padding: 1px 5px; font-size: 14px; font-family: monospace; }
              .md-content strong { color: #e2d5bb; } .md-content em { color: rgba(226,213,187,0.75); }
              .md-content hr { border: none; border-top: 1px solid rgba(200,148,58,0.15); margin: 14px 0; }
              .md-content a { color: #c8943a; }
            `}</style>
          </div>
        )}

        {/* DM Append section — shown when DM is viewing someone else's note */}
        {canAppendEffective && (
          <div style={{ borderTop: '1px solid rgba(200,148,58,0.2)', padding: '12px 20px', background: 'rgba(200,148,58,0.04)' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.6)', marginBottom: '8px' }}>
              ⚔ DM ADDITION — appended with your name and date
            </div>
            <textarea
              style={{
                width: '100%', minHeight: '80px', background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(200,148,58,0.2)', borderRadius: '3px',
                color: '#e2d5bb', fontSize: '14px', fontFamily: 'Crimson Pro, serif',
                padding: '8px 12px', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
              placeholder="Write your DM addition here... It will be permanently appended to this note."
              value={appendContent}
              onChange={e => setAppendContent(e.target.value)}
            />
            <button
              style={{
                marginTop: '8px', padding: '5px 16px',
                background: appendContent.trim() ? 'linear-gradient(135deg, #c8943a, #a07030)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${appendContent.trim() ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '3px', cursor: appendContent.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em',
                color: appendContent.trim() ? '#07080e' : 'rgba(226,213,187,0.3)',
              }}
              disabled={!appendContent.trim() || appendSaving}
              onClick={async () => {
                if (!appendContent.trim() || !note?.id) return;
                setAppendSaving(true);
                try {
                  await api.put(`/notes/${note.id}`, { append_content: appendContent });
                  setAppendContent('');
                  if (onSave) onSave();
                } catch (err) {
                  console.error('Append failed', err);
                } finally {
                  setAppendSaving(false);
                }
              }}
            >
              {appendSaving ? 'APPENDING...' : '⚔ APPEND TO NOTE'}
            </button>
          </div>
        )}
      </div>
      </div>

      {/* ── Bottom Drawer: handle bar (lifted above home indicator / bottom edge) ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(7,8,14,0.6)',
        display: 'flex', alignItems: 'center',
        padding: '6px 16px max(10px, env(safe-area-inset-bottom, 0px))',
        flexShrink: 0,
        userSelect: 'none',
      }}>
        {/* Tabs */}
        {[
          { id: 'connections', label: `Connections${myConns.length ? ` (${myConns.length})` : ''}` },
          { id: 'tags',        label: `Tags${tags.length ? ` (${tags.length})` : ''}` },
          { id: 'images',      label: `Images${images.length ? ` (${images.length})` : ''}` },
          ...(canManageUi ? [{ id: 'permissions', label: noteVisibility === 'shared' ? '⚔ Party Shared' : '🔒 Access' }] : []),
        ].map(tab => (
          <button key={tab.id}
            onClick={() => { setDrawerTab(tab.id); setDrawerOpen(o => drawerTab === tab.id ? !o : true); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em',
              color: drawerOpen && drawerTab === tab.id ? '#c8943a' : 'rgba(226,213,187,0.3)',
              padding: isMobile ? '12px 14px' : '8px 12px',
              minHeight: isMobile ? '44px' : 'auto',
              borderBottom: drawerOpen && drawerTab === tab.id ? '2px solid rgba(200,148,58,0.6)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >{tab.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setDrawerOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(226,213,187,0.25)', fontSize: '14px', padding: '6px 8px', lineHeight: 1, transition: 'transform 0.2s', transform: drawerOpen ? 'rotate(180deg)' : 'none' }}
          title={drawerOpen ? 'Collapse' : 'Expand'}
        >⌃</button>
      </div>

      {/* ── Bottom Drawer: panel (~1/3 viewport when open — room for suggestion dropdowns) ── */}
      <div style={{
        overflow: 'hidden',
        maxHeight: drawerOpen ? DRAWER_EXPANDED_MAX_HEIGHT : '0',
        transition: 'max-height 0.24s ease',
        flexShrink: 0,
        background: 'rgba(0,0,0,0.25)',
        borderTop: drawerOpen ? '1px solid rgba(255,255,255,0.05)' : 'none',
      }}>
        <div style={{ padding: '14px 24px', overflowY: 'auto', maxHeight: drawerOpen ? DRAWER_EXPANDED_MAX_HEIGHT : '0', boxSizing: 'border-box' }}>

          {/* Connections tab */}
          {drawerTab === 'connections' && (
            <div>
              {myConns.length > 0 && (
                <div style={S.connList}>
                  {myConns.map(conn => {
                    const linkedId = conn.source_note_id === note.id ? conn.target_note_id : conn.source_note_id;
                    const linkedNote = notes.find(n => n.id === linkedId);
                    if (!linkedNote) return null;
                    const color = getCategoryColor(linkedNote.category);
                    return (
                      <span key={conn.id} style={S.connTag(color)}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                        {linkedNote.title}
                        <button style={S.connRemove} onClick={() => handleRemoveConnection(conn.id)}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={S.connSearch}>
                <input
                  ref={connInputRef}
                  style={S.connInput}
                  value={connSearch}
                  onChange={(e) => { setConnSearch(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  placeholder="+ Link another note..."
                />
              </div>
            </div>
          )}

          {/* Tags tab */}
          {drawerTab === 'tags' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
                  background: 'rgba(200,148,58,0.1)', border: '1px solid rgba(200,148,58,0.25)',
                  color: '#c8943a', fontFamily: 'Cinzel', letterSpacing: '0.05em',
                }}>
                  #{tag}
                  {canEdit && <button onClick={() => handleRemoveTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(200,148,58,0.5)', padding: '0 0 0 2px', fontSize: '12px', lineHeight: 1 }}>×</button>}
                </span>
              ))}
              {canEdit && (
                <div style={{ position: 'relative' }}>
                  <input
                    ref={tagInputRef}
                    style={{ ...S.connInput, width: '120px', paddingLeft: '8px' }}
                    value={tagInput}
                    onChange={e => { setTagInput(e.target.value); setShowTagSuggestions(true); }}
                    onKeyDown={handleTagKeyDown}
                    onFocus={() => setShowTagSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                    placeholder="+ add tag..."
                  />
                </div>
              )}
              {tags.length === 0 && !canEdit && <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.25)', fontStyle: 'italic' }}>No tags.</span>}
            </div>
          )}

          {/* Images tab */}
          {drawerTab === 'images' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: images.length ? '10px' : 0 }}>
                {canEdit && (
                  <>
                    <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploadingImage}
                      style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.4)' }}
                    >{uploadingImage ? 'UPLOADING...' : '+ UPLOAD IMAGE'}</button>
                  </>
                )}
              </div>
              {images.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {images.map(img => (
                    <div key={img.id} style={{ position: 'relative' }}>
                      <img
                        src={img.url} alt={img.original_name}
                        style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                        onClick={() => insertImageMarkdown(img)}
                        title={`Click to insert: ${img.original_name}`}
                      />
                      {canEdit && (
                        <button onClick={() => handleDeleteImage(img.id)}
                          style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', color: 'rgba(226,213,187,0.7)', fontSize: '10px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.25)', fontStyle: 'italic' }}>No images attached.</span>
              )}
            </div>
          )}

          {/* Permissions tab */}
          {drawerTab === 'permissions' && canManage && (
            <div>
              {/* DM Only toggle — available on any note/folder for DMs and admins */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', marginBottom: '14px', borderRadius: '3px', background: isDmOnly ? 'rgba(200,148,58,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isDmOnly ? 'rgba(200,148,58,0.25)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}
                onClick={handleDmOnlyToggle}
              >
                <button
                  style={{
                    width: '32px', height: '18px', borderRadius: '9px', cursor: 'pointer',
                    border: 'none', position: 'relative', flexShrink: 0,
                    background: isDmOnly ? 'rgba(200,148,58,0.6)' : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.2s',
                  }}
                  onClick={e => { e.stopPropagation(); handleDmOnlyToggle(); }}
                >
                  <span style={{ position: 'absolute', top: '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#e2d5bb', transition: 'left 0.15s', left: isDmOnly ? '16px' : '2px' }} />
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: isDmOnly ? '#c8943a' : 'rgba(226,213,187,0.5)' }}>⚔ DM ONLY</div>
                  <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.35)', fontStyle: 'italic', marginTop: '2px' }}>
                    {isDmOnly ? 'Hidden from party members — visible to DMs and admins only' : 'Visible to all party members with access'}
                  </div>
                </div>
              </div>
              {/* Root folder: campaign member + DM management */}
              {isRootFolder ? (
                <div>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)', marginBottom: '10px' }}>PARTY MEMBERS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '14px' }}>
                    {allUsers.map(u => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', borderRadius: '3px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '15px', color: 'rgba(226,213,187,0.85)', flex: 1 }}>
                          {u.username}
                          {!!u.is_admin && <span style={{ marginLeft: '6px', fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.5)', letterSpacing: '0.1em' }}>ADMIN</span>}
                        </span>
                        {/* DM label + toggle */}
                        <span style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.08em', color: u.is_dm ? 'rgba(200,148,58,0.8)' : 'rgba(226,213,187,0.18)' }}>DM</span>
                        <button
                          onClick={() => handleToggleDM(u.id, !!u.is_dm)}
                          title={u.is_dm ? 'Remove DM role' : 'Assign as DM'}
                          style={{
                            width: '30px', height: '16px', borderRadius: '8px', cursor: 'pointer',
                            border: 'none', position: 'relative', flexShrink: 0,
                            background: u.is_dm ? 'rgba(200,148,58,0.55)' : 'rgba(255,255,255,0.1)',
                            transition: 'background 0.2s',
                          }}
                        >
                          <span style={{ position: 'absolute', top: '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#e2d5bb', transition: 'left 0.15s', left: u.is_dm ? '16px' : '2px' }} />
                        </button>
                        {/* Remove from party */}
                        <button
                          onClick={() => handleRemoveMember(u.id)}
                          title="Remove from party"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(224,112,112,0.35)', fontSize: '14px', padding: '0 2px', lineHeight: 1, flexShrink: 0, transition: 'color 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'rgba(224,112,112,0.75)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'rgba(224,112,112,0.35)'}
                        >×</button>
                      </div>
                    ))}
                    {allUsers.length === 0 && (
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.25)', fontStyle: 'italic' }}>No other party members yet.</div>
                    )}
                  </div>

                  {/* Add member — button + inline popover */}
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                      onClick={() => { setShowAddMember(v => !v); setAddMemberSearch(''); }}
                      style={{
                        padding: '5px 14px', borderRadius: '3px', cursor: 'pointer',
                        fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em',
                        background: showAddMember ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${showAddMember ? 'rgba(200,148,58,0.35)' : 'rgba(255,255,255,0.1)'}`,
                        color: showAddMember ? '#c8943a' : 'rgba(226,213,187,0.45)',
                        transition: 'all 0.15s',
                      }}
                    >⊕ ADD TO PARTY</button>

                    {showAddMember && (() => {
                      const existing = new Set(allUsers.map(u => u.id));
                      const available = allSystemUsers.filter(u =>
                        !existing.has(u.id) &&
                        (!addMemberSearch || u.username.toLowerCase().includes(addMemberSearch.toLowerCase()))
                      );
                      return (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 50,
                          background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)',
                          borderRadius: '4px', minWidth: '200px', maxHeight: '220px',
                          boxShadow: '0 6px 24px rgba(0,0,0,0.6)', overflow: 'hidden',
                          display: 'flex', flexDirection: 'column',
                        }}>
                          <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                            <input
                              autoFocus
                              style={{ ...S.connInput, width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '4px 8px' }}
                              value={addMemberSearch}
                              onChange={e => setAddMemberSearch(e.target.value)}
                              placeholder="Filter users..."
                            />
                          </div>
                          <div style={{ overflowY: 'auto', flex: 1 }}>
                            {available.length === 0 ? (
                              <div style={{ padding: '10px 12px', fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.3)', fontStyle: 'italic' }}>
                                {allSystemUsers.length === 0 ? 'No other users in system.' : 'All users already in party.'}
                              </div>
                            ) : available.map(u => (
                              <div key={u.id}
                                onClick={() => handleAddMember(u.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(200,148,58,0.08)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.75)', flex: 1 }}>{u.username}</span>
                                {!!u.is_admin && <span style={{ fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.5)', letterSpacing: '0.08em' }}>ADMIN</span>}
                                <span style={{ color: 'rgba(58,196,139,0.5)', fontSize: '14px', lineHeight: 1 }}>+</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                /* Non-root note/folder */
                <div>
                  {isDmOnly ? (
                    /* DM Only is on — show per-member grant toggles */
                    <div>
                      <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.5)', marginBottom: '10px' }}>
                        ⚔ DM ONLY — GRANT INDIVIDUAL ACCESS
                      </div>
                      <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '12px', color: 'rgba(226,213,187,0.35)', fontStyle: 'italic', marginBottom: '12px' }}>
                        DMs always have access. Toggle individual party members below.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {allUsers.map(u => {
                          const isDmMember = !!u.is_dm || !!u.is_admin;
                          const granted = isDmMember || grantedUsers.includes(u.id);
                          return (
                            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '3px', background: granted ? 'rgba(58,196,139,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${granted ? 'rgba(58,196,139,0.12)' : 'transparent'}` }}>
                              <button
                                disabled={isDmMember}
                                onClick={() => !isDmMember && handleGrantToggle(u.id)}
                                style={{ width: '32px', height: '18px', borderRadius: '9px', cursor: isDmMember ? 'default' : 'pointer', border: 'none', position: 'relative', flexShrink: 0, background: granted ? 'rgba(58,196,139,0.4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s', opacity: isDmMember ? 0.5 : 1 }}
                              >
                                <span style={{ position: 'absolute', top: '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#e2d5bb', transition: 'left 0.2s', left: granted ? '16px' : '2px' }} />
                              </button>
                              <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: granted ? 'rgba(226,213,187,0.8)' : 'rgba(226,213,187,0.3)', flex: 1 }}>
                                {u.username}
                                {!!u.is_admin && <span style={{ marginLeft: '6px', fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.5)', letterSpacing: '0.1em' }}>ADMIN</span>}
                                {!u.is_admin && !!u.is_dm && <span style={{ marginLeft: '6px', fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.5)', letterSpacing: '0.1em' }}>DM</span>}
                              </span>
                              {isDmMember && <span style={{ fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.4)', letterSpacing: '0.08em' }}>ALWAYS</span>}
                              {!isDmMember && granted && <span style={{ fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(58,196,139,0.5)', letterSpacing: '0.08em' }}>GRANTED</span>}
                            </div>
                          );
                        })}
                        {allUsers.length === 0 && (
                          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.25)', fontStyle: 'italic' }}>No other party members.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Normal mode — visibility + grant toggles */
                    <div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                        {(() => {
                          const allPartyGranted = allUsers.length > 0 && allUsers.every(u => grantedUsers.includes(u.id));
                          return [
                            { val: 'hidden', label: '🔒 Hidden',       desc: 'Only you (+ granted users)', active: !allPartyGranted },
                            { val: 'shared', label: '⚔ Party Shared', desc: 'Grant access to all party',  active: allPartyGranted },
                          ].map(({ val, label, desc, active }) => (
                            <button key={val} onClick={() => handleVisibilityChange(val)} style={{
                              flex: 1, padding: '8px 6px', borderRadius: '3px', cursor: 'pointer',
                              fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.08em',
                              background: active ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${active ? 'rgba(200,148,58,0.4)' : 'rgba(255,255,255,0.08)'}`,
                              color: active ? '#c8943a' : 'rgba(226,213,187,0.35)',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                            }}>
                              <span>{label}</span>
                              <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '10px', letterSpacing: '0', opacity: 0.6, textTransform: 'none' }}>{desc}</span>
                            </button>
                          ));
                        })()}
                      </div>
                      {allUsers.length > 0 && (
                        <>
                          {(() => {
                            const allPartyGranted = allUsers.every(u => grantedUsers.includes(u.id));
                            return (
                              <>
                                <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.12em', color: 'rgba(200,148,58,0.4)', marginBottom: '8px' }}>
                                  {allPartyGranted ? 'ALL PARTY MEMBERS HAVE ACCESS' : 'GRANT ACCESS TO SPECIFIC USERS'}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {allUsers.map(u => {
                                    const granted = grantedUsers.includes(u.id);
                                    return (
                                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '3px', background: granted ? 'rgba(58,196,139,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${granted ? 'rgba(58,196,139,0.12)' : 'transparent'}` }}>
                                        <button onClick={() => handleGrantToggle(u.id)} style={{ width: '32px', height: '18px', borderRadius: '9px', cursor: 'pointer', border: 'none', position: 'relative', flexShrink: 0, background: granted ? 'rgba(58,196,139,0.4)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s' }}>
                                          <span style={{ position: 'absolute', top: '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#e2d5bb', transition: 'left 0.2s', left: granted ? '16px' : '2px' }} />
                                        </button>
                                        <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: granted ? 'rgba(226,213,187,0.8)' : 'rgba(226,213,187,0.3)', flex: 1 }}>
                                          {u.username}
                                          {!!u.is_admin && <span style={{ marginLeft: '6px', fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(200,148,58,0.5)', letterSpacing: '0.1em' }}>ADMIN</span>}
                                        </span>
                                        {granted && <span style={{ fontFamily: 'Cinzel', fontSize: '7px', color: 'rgba(58,196,139,0.5)', letterSpacing: '0.08em' }}>CAN VIEW & EDIT</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                  {!!note?.is_folder && (
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setCascadeChildren(c => !c)}>
                      <div style={{ width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0, border: `1px solid ${cascadeChildren ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.15)'}`, background: cascadeChildren ? 'rgba(200,148,58,0.2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {cascadeChildren && <span style={{ color: '#c8943a', fontSize: '10px', lineHeight: 1 }}>✓</span>}
                      </div>
                      <span style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: cascadeChildren ? 'rgba(226,213,187,0.7)' : 'rgba(226,213,187,0.35)' }}>Apply to all contents of this folder</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Markdown help slide-out panel */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 20,
        display: 'flex', pointerEvents: 'none',
      }}>
        {/* Sliding panel */}
        <div style={{
          pointerEvents: 'all',
          background: 'rgba(7,8,14,0.97)', borderLeft: '1px solid rgba(200,148,58,0.25)',
          width: showMdHelp ? '240px' : '0',
          overflow: 'hidden',
          transition: 'width 0.22s ease',
          overflowY: showMdHelp ? 'auto' : 'hidden',
        }}>
          <div style={{ width: '220px', padding: '16px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)' }}>MARKDOWN REFERENCE</div>
              <button
                onClick={() => setShowMdHelp(false)}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer', color: 'rgba(226,213,187,0.4)', fontSize: '12px', padding: '1px 6px', fontFamily: 'Cinzel', letterSpacing: '0.05em', lineHeight: 1.4 }}
                title="Close"
              >✕</button>
            </div>
            {[
              { syntax: '# Heading 1',        shortcut: 'Ctrl+Shift+1' },
              { syntax: '## Heading 2',        shortcut: 'Ctrl+Shift+2' },
              { syntax: '### Heading 3',       shortcut: 'Ctrl+Shift+3' },
              { syntax: '**bold**',            shortcut: 'Ctrl+B' },
              { syntax: '*italic*',            shortcut: 'Ctrl+I' },
              { syntax: '~~strikethrough~~',   shortcut: 'Ctrl+Shift+X' },
              { syntax: '`inline code`',       shortcut: 'Ctrl+`' },
              { syntax: '[text](url)',          shortcut: 'Ctrl+K' },
              { syntax: '> blockquote',        shortcut: 'Ctrl+Shift+.' },
              { syntax: '- bullet',            shortcut: 'Ctrl+Shift+U' },
              { syntax: '1. numbered',         shortcut: null },
              { syntax: '- [ ] / - [x] task', shortcut: null },
              { syntax: '```\ncode block\n```',shortcut: null },
              { syntax: '---  (divider)',       shortcut: null },
              { syntax: '| col | col |',        shortcut: null },
              { syntax: 'Tab / Shift+Tab',      shortcut: 'indent / outdent' },
              { syntax: 'Enter in list',        shortcut: 'continue list' },
            ].map(({ syntax, shortcut }) => (
              <div key={syntax} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px', marginBottom: '6px', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(200,148,58,0.85)', whiteSpace: 'nowrap' }}>{syntax}</span>
                {shortcut && (
                  <span style={{ fontFamily: 'monospace', fontSize: '8px', color: 'rgba(200,148,58,0.55)', background: 'rgba(200,148,58,0.06)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(200,148,58,0.12)', whiteSpace: 'nowrap', flexShrink: 0 }}>{shortcut}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showDropdown && connSearch && filteredNotes.length > 0 && connDropdownFixed &&
        createPortal(
          <div
            role="listbox"
            style={{
              ...S.dropdown,
              position: 'fixed',
              left: connDropdownFixed.left,
              width: connDropdownFixed.width,
              bottom: connDropdownFixed.bottom,
              top: 'auto',
              marginBottom: 0,
              maxHeight: connDropdownFixed.maxHeight,
              zIndex: 10000,
              boxShadow: '0 -8px 28px rgba(0,0,0,0.75)',
            }}
          >
            {filteredNotes.map((n) => (
              <div
                key={n.id}
                style={S.dropItem}
                onMouseDown={() => handleAddConnection(n)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(200,148,58,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: getCategoryColor(n.category),
                    flexShrink: 0,
                  }}
                />
                {n.title}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {showTagSuggestions && tagSuggestions.length > 0 && tagDropdownFixed &&
        createPortal(
          <div
            role="listbox"
            style={{
              ...S.dropdown,
              position: 'fixed',
              left: tagDropdownFixed.left,
              width: tagDropdownFixed.width,
              bottom: tagDropdownFixed.bottom,
              top: 'auto',
              marginBottom: 0,
              maxHeight: tagDropdownFixed.maxHeight,
              minWidth: '140px',
              zIndex: 10000,
              boxShadow: '0 -8px 28px rgba(0,0,0,0.75)',
            }}
          >
            {tagSuggestions.map((t) => (
              <div
                key={t}
                style={S.dropItem}
                onMouseDown={() => handleAddTag(t)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(200,148,58,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                #{t}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {mentionPopup &&
        mentionPopup.field &&
        mentionPopup.field !== 'body' &&
        mentionPopup.items?.length > 0 &&
        mentionPromptFixed &&
        createPortal(
          <div
            role="listbox"
            style={{
              position: 'fixed',
              left: mentionPromptFixed.left,
              width: mentionPromptFixed.width,
              bottom: mentionPromptFixed.bottom,
              top: 'auto',
              maxHeight: mentionPromptFixed.maxHeight,
              overflowY: 'auto',
              background: '#12151c',
              border: '1px solid rgba(200,148,58,0.35)',
              borderRadius: '4px',
              boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
              zIndex: 10000,
            }}
          >
            <div
              style={{
                fontFamily: 'Cinzel',
                fontSize: '7px',
                letterSpacing: '0.12em',
                color: 'rgba(200,148,58,0.45)',
                padding: '6px 10px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              @ LINKS (DM AI PROMPT) — ↑↓ ENTER TAB
            </div>
            {mentionPopup.items.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => applyMentionChoice(it)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderLeft: `3px solid ${getCategoryColor(it.category)}`,
                  background:
                    idx === mentionPopup.activeIndex ? 'rgba(200,148,58,0.12)' : 'transparent',
                  color: '#e2d5bb',
                  fontFamily: 'Crimson Pro, serif',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {it.title}
                </span>
                <span
                  style={{
                    fontFamily: 'Cinzel',
                    fontSize: '7px',
                    letterSpacing: '0.06em',
                    color: 'rgba(226,213,187,0.35)',
                    flexShrink: 0,
                  }}
                >
                  {it.category}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {conflict && (
        <ConflictModal
          conflict={conflict}
          onKeepMine={() => {
            serverUpdatedAt.current = conflict.serverUpdatedAt;
            setConflict(null);
            doSave();
          }}
          onKeepTheirs={() => {
            setTitle(conflict.serverTitle);
            setContent(conflict.serverContent);
            serverUpdatedAt.current = conflict.serverUpdatedAt;
            setConflict(null);
            setDirty(false);
          }}
          onKeepBoth={() => {
            const divider = `\n\n---\n*✏ My edits — ${new Date().toLocaleString()}:*\n`;
            const merged = conflict.serverContent + divider + conflict.myContent;
            setContent(merged);
            serverUpdatedAt.current = conflict.serverUpdatedAt;
            setConflict(null);
            setDirty(true);
          }}
        />
      )}
    </div>
  );
}

// Eyeball tooltip — who can see this note
function WhoCanSee({ note, allUsers, currentUser }) {
  const [hovered, setHovered] = useState(false);
  if (!note) return null;

  const getViewers = () => {
    if (note.visibility === 'shared') return ['Everyone'];
    const names = [];
    // Owner always sees it
    const ownerName = note.author || 'You';
    names.push(`${ownerName} (owner)`);
    // Admins always see it
    allUsers.filter(u => u.is_admin && u.id !== note.user_id).forEach(u => names.push(`${u.username} (admin)`));
    // Granted users
    (note.granted_users || []).forEach(uid => {
      const u = allUsers.find(u => u.id === uid);
      if (u && !u.is_admin) names.push(u.username);
    });
    return names;
  };

  const viewers = getViewers();

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <span style={{ fontSize: '13px', cursor: 'default', opacity: 0.35, userSelect: 'none', lineHeight: 1 }} title="Who can see this">👁</span>
      {hovered && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: '6px', zIndex: 100,
          background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)',
          borderRadius: '4px', padding: '8px 12px', minWidth: '160px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.5)', marginBottom: '6px' }}>VISIBLE TO</div>
          {viewers.map((v, i) => (
            <div key={i} style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.7)', lineHeight: '1.6' }}>{v}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Conflict resolution modal
function ConflictModal({ conflict, onKeepMine, onKeepTheirs, onKeepBoth }) {
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(7,8,14,0.88)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(2px)',
  };
  const modal = {
    background: '#0e1020',
    border: '1px solid rgba(224,112,112,0.35)',
    borderRadius: '6px',
    width: '640px', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
  };
  const pane = {
    overflowY: 'auto',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '3px',
    fontFamily: 'Crimson Pro, serif',
    fontSize: '13px',
    color: 'rgba(226,213,187,0.7)',
    whiteSpace: 'pre-wrap',
    lineHeight: '1.5',
    maxHeight: '180px',
  };
  const btnBase = {
    borderRadius: '4px', padding: '8px 18px',
    fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.1em',
    cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
  };
  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.1em', color: 'rgba(224,112,112,0.9)', marginBottom: '4px' }}>
            ⚔ EDIT CONFLICT
          </div>
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '13px', color: 'rgba(226,213,187,0.5)', fontStyle: 'italic' }}>
            {conflict.serverUpdatedBy
              ? `${conflict.serverUpdatedBy} saved a newer version while you were writing.`
              : 'A newer version was saved while you were writing.'}
            {' '}Choose how to proceed.
          </div>
        </div>
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(139,196,226,0.6)', marginBottom: '6px' }}>THEIR VERSION (server)</div>
            <div style={pane}>{conflict.serverContent || ''}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.6)', marginBottom: '6px' }}>YOUR VERSION (unsaved)</div>
            <div style={{ ...pane, borderColor: 'rgba(200,148,58,0.15)' }}>{conflict.myContent || ''}</div>
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button style={{ ...btnBase, background: 'transparent', borderColor: 'rgba(226,213,187,0.15)', color: 'rgba(226,213,187,0.4)' }} onClick={onKeepTheirs}>Keep Theirs</button>
          <button style={{ ...btnBase, background: 'rgba(139,196,226,0.08)', borderColor: 'rgba(139,196,226,0.3)', color: 'rgba(139,196,226,0.8)' }} onClick={onKeepBoth}>Keep Both</button>
          <button style={{ ...btnBase, background: 'rgba(200,148,58,0.12)', borderColor: 'rgba(200,148,58,0.4)', color: '#c8943a' }} onClick={onKeepMine}>Keep Mine</button>
        </div>
      </div>
    </div>
  );
}
