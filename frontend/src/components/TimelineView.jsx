import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api.js';
import { clientPointToSvgUser, getRootTextScale, svgUserPointToClient } from '../utils/svgClientCoords.js';
import { getGraphCampaignRoots, isUnderCompletedArchive } from '../utils/campaignTree.js';
import { getCategoryColor } from './NoteEditor.jsx';
import TimelineNoteExpand from './TimelineNoteExpand.jsx';
import { useWindowWidth } from '../hooks/useWindowWidth.js';
import {
  TIMELINE_BOX_W,
  TIMELINE_BOX_H,
  TIMELINE_MIN_BRANCH,
  TIMELINE_AXIS_PAD,
  TIMELINE_EXTEND_STEP,
  buildBranchPathToBox,
  serializeBranchPath,
  parseBranchPath,
  pathToSvgPoints,
  computeCanvasWidth,
  computeContentBounds,
  ensureAxisExtendFitsContent,
  trimAxisExtend,
  timelineBoxTitle,
  hexToRgba,
  TIMELINE_CLICK_THRESHOLD,
  entryWithGeometry,
  clampBoxOffsets,
  clampAnchorDisplayX,
  clampEntryGeometryToCanvas,
  timelineGeometryChanged,
  resolveTimelineCanvasMetrics,
} from '../utils/timelineGeometry.js';

/** Hit area (px) above/below the axis for starting a new branch. */
const LINE_HIT = 22;

/** Hit area (px) for Past / Present / Trim axis controls (fixed size). */
const AXIS_LABEL_HIT_W = 104;
const AXIS_LABEL_HIT_H = 30;

/** Anchor handle radius for dragging along the axis. */
const ANCHOR_HIT_R = 12;

/** Note categories for grouped picker (matches NoteEditor). */
const NOTE_CATEGORY_ORDER = [
  { value: 'npc', label: 'NPC / Character' },
  { value: 'location', label: 'Location' },
  { value: 'faction', label: 'Faction / Org' },
  { value: 'item', label: 'Item / Artifact' },
  { value: 'event', label: 'Quest / Event' },
  { value: 'lore', label: 'Lore / History' },
  { value: 'general', label: 'General' },
];

/**
 * Returns note rows that live under a campaign folder (non-folder notes only).
 * @param {Array<object>} allNotes
 * @param {number} campaignFolderId
 * @returns {Array<object>}
 */
function notesInCampaignSubtree(allNotes, campaignFolderId) {
  const byId = new Map((allNotes || []).map((n) => [n.id, n]));
  const isUnder = (noteId) => {
    let cur = byId.get(noteId);
    for (let i = 0; i < 500 && cur; i++) {
      if (cur.id === campaignFolderId) return true;
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
    }
    return false;
  };
  return (allNotes || []).filter((n) => !n.is_folder && isUnder(n.id));
}

/**
 * Groups campaign notes by category for the event editor picker.
 * @param {Array<object>} notes
 * @param {string} search
 * @returns {Array<{ value: string, label: string, notes: object[] }>}
 */
function groupNotesByCategory(notes, search) {
  const q = search.trim().toLowerCase();
  const filtered = (notes || []).filter((n) => {
    if (!q) return true;
    const title = String(n.title || '').toLowerCase();
    const cat = String(n.category || 'general').toLowerCase();
    const meta = NOTE_CATEGORY_ORDER.find((c) => c.value === (n.category || 'general'));
    const catLabel = (meta?.label || cat).toLowerCase();
    return title.includes(q) || cat.includes(q) || catLabel.includes(q);
  });

  const byCat = new Map();
  for (const n of filtered) {
    const key = n.category || 'general';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(n);
  }

  const extraKeys = [...byCat.keys()].filter((k) => !NOTE_CATEGORY_ORDER.some((c) => c.value === k));
  const order = [
    ...NOTE_CATEGORY_ORDER.map((c) => c.value),
    ...extraKeys,
  ];

  return order
    .filter((value) => byCat.has(value))
    .map((value) => {
      const meta = NOTE_CATEGORY_ORDER.find((c) => c.value === value);
      return {
        value,
        label: meta?.label || value,
        notes: byCat.get(value).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
      };
    });
}

/**
 * Interactive campaign timeline: click the axis, drag to branch, release to place a box.
 * @param {{
 *   notes: Array<object>,
 *   currentUser?: { id?: number },
 *   dmCampaignIds?: number[],
 *   tutorialRefs?: { shell?: import('react').RefObject<HTMLElement|null>, campaignPicker?: import('react').RefObject<HTMLElement|null>, canvas?: import('react').RefObject<HTMLElement|null> },
 *   onSelectNote?: (id: number) => void,
 * }} props
 */
export default function TimelineView({ notes, currentUser, dmCampaignIds = [], tutorialRefs = null, onSelectNote, tutorialCampaignId = null }) {
  const [entries, setEntries] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  /** @type {[null|{ mode: 'create', storedAnchorX: number, endX: number, endY: number }|{ mode: 'anchor'|'box', entryId: number, storedAnchorX: number, endX: number, endY: number, armed: boolean }, function]} */
  const [interaction, setInteraction] = useState(null);
  const [editorEntry, setEditorEntry] = useState(null);
  const [noteExpand, setNoteExpand] = useState(null);
  const [axisExtend, setAxisExtend] = useState({ left: 0, right: 0 });
  const [scrollViewportW, setScrollViewportW] = useState(720);
  const [scrollViewportH, setScrollViewportH] = useState(480);
  const [shiftHeld, setShiftHeld] = useState(false);
  /** Axis hover position for the “click and drag to add point” hint (SVG x), or null. */
  const [axisHover, setAxisHover] = useState(null);

  const scrollRef = useRef(null);
  const svgRef = useRef(null);
  const interactionRef = useRef(null);
  const pointerStartRef = useRef(null);
  const wsIgnoreUntilRef = useRef(0);
  const contentFitDoneRef = useRef(false);
  const noteContentCacheRef = useRef({});
  const windowWidth = useWindowWidth();

  /** Tracks Shift for Past/Present trim affordance. */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const onKeyUp = (e) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    const onBlur = () => setShiftHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  /** Tracks scroll-container size so the canvas matches the visible area (stable under text scale). */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const sync = () => {
      setScrollViewportW(el.clientWidth || windowWidth || 720);
      setScrollViewportH(el.clientHeight || 480);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, windowWidth]);

  const campaignRoots = useMemo(() => getGraphCampaignRoots(notes), [notes]);

  const folderKey = `chronicler_timeline_folder_${currentUser?.id || 'anon'}`;
  const [activeFolderId, setActiveFolderIdRaw] = useState(() => {
    try {
      const s = localStorage.getItem(folderKey);
      return s ? parseInt(s, 10) : null;
    } catch {
      return null;
    }
  });

  /**
   * Persists the selected campaign folder for the timeline tab.
   * @param {number|null} id
   */
  const setActiveFolderId = (id) => {
    setActiveFolderIdRaw(id);
    try {
      if (id) localStorage.setItem(folderKey, String(id));
      else localStorage.removeItem(folderKey);
    } catch { /* ignore */ }
  };

  /** Tutorial override — does not write localStorage so the user's prior pick is restored after the tour. */
  const resolvedFolderId = tutorialCampaignId ?? activeFolderId;

  useEffect(() => {
    if (tutorialCampaignId != null) return;
    if (campaignRoots.length === 0) return;
    const ids = new Set(campaignRoots.map((f) => f.id));
    if (activeFolderId == null || !ids.has(activeFolderId)) {
      setActiveFolderId(campaignRoots[0].id);
    }
  }, [campaignRoots, activeFolderId, tutorialCampaignId]);

  const extendKey = `chronicler_timeline_extend_${currentUser?.id || 'anon'}_${resolvedFolderId || 'none'}`;

  useEffect(() => {
    if (!resolvedFolderId) return;
    contentFitDoneRef.current = false;
    try {
      const raw = localStorage.getItem(extendKey);
      setAxisExtend(raw ? JSON.parse(raw) : { left: 0, right: 0 });
    } catch {
      setAxisExtend({ left: 0, right: 0 });
    }
  }, [extendKey, resolvedFolderId]);

  useEffect(() => {
    if (!resolvedFolderId) return;
    try {
      localStorage.setItem(extendKey, JSON.stringify(axisExtend));
    } catch { /* ignore */ }
  }, [axisExtend, extendKey, resolvedFolderId]);

  const contentOffsetX = axisExtend.left;

  /**
   * Converts stored anchor x to SVG display x (includes past extension offset).
   * @param {number} storedX
   * @returns {number}
   */
  const toDisplayX = useCallback((storedX) => storedX + contentOffsetX, [contentOffsetX]);

  /**
   * Converts SVG display x to stored anchor x for the API.
   * @param {number} displayX
   * @returns {number}
   */
  const toStoredAnchorX = useCallback((displayX) => displayX - contentOffsetX, [contentOffsetX]);

  const loadTimeline = useCallback(async () => {
    if (!resolvedFolderId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/timeline', { params: { folder_id: resolvedFolderId } });
      const points = res.data.points || [];
      setEntries(points);
      setCanEdit(!!res.data.can_edit);
      if (!contentFitDoneRef.current) {
        const vw = scrollRef.current?.clientWidth || windowWidth || 720;
        setAxisExtend((prev) => ensureAxisExtendFitsContent(points, vw, prev));
        contentFitDoneRef.current = true;
      }
    } catch (e) {
      console.error(e);
      setError('Could not load timeline.');
    } finally {
      setLoading(false);
    }
  }, [resolvedFolderId, windowWidth]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    const handler = (e) => {
      try {
        const raw = e.data || e.detail;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg.type === 'timeline_changed' && msg.folder_id === resolvedFolderId) {
          if (interactionRef.current) return;
          if (Date.now() < wsIgnoreUntilRef.current) return;
          loadTimeline();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('ws_timeline', handler);
    return () => window.removeEventListener('ws_timeline', handler);
  }, [loadTimeline, resolvedFolderId]);

  const viewportW = scrollViewportW || windowWidth || 720;
  const { canvasHeight, lineY: timelineLineY } = useMemo(
    () => resolveTimelineCanvasMetrics(scrollViewportH),
    [scrollViewportH],
  );

  const canvasWidth = useMemo(
    () => computeCanvasWidth(viewportW, axisExtend.left, axisExtend.right),
    [viewportW, axisExtend.left, axisExtend.right]
  );

  /** Pulls boxes toward the axis when the viewport is shorter than stored offsets allow. */
  useEffect(() => {
    if (loading || interaction) return;
    setEntries((prev) => {
      if (!prev.length) return prev;
      const adjusted = prev.map((e) => (
        clampEntryGeometryToCanvas(e, contentOffsetX, canvasWidth, canvasHeight, timelineLineY)
      ));
      return adjusted.some((e, i) => timelineGeometryChanged(e, prev[i])) ? adjusted : prev;
    });
  }, [canvasHeight, canvasWidth, contentOffsetX, timelineLineY, loading, interaction]);

  /**
   * Maps a timeline entry's box to viewport coordinates for expand/collapse animations.
   * @param {object} entry
   * @returns {{ left: number, top: number, width: number, height: number }|null}
   */
  const getBoxScreenRect = useCallback((entry) => {
    const svg = svgRef.current;
    if (!svg || !entry) return null;
    const ax = (entry.anchor_x ?? 0) + contentOffsetX;
    const cx = ax + (entry.end_x ?? 0);
    const cy = timelineLineY + (entry.end_y ?? 0);
    const x0 = cx - TIMELINE_BOX_W / 2;
    const y0 = cy - TIMELINE_BOX_H / 2;
    const tl = svgUserPointToClient(svg, x0, y0);
    const br = svgUserPointToClient(svg, x0 + TIMELINE_BOX_W, y0 + TIMELINE_BOX_H);
    if (!tl || !br) return null;
    return {
      left: Math.min(tl.x, br.x),
      top: Math.min(tl.y, br.y),
      width: Math.abs(br.x - tl.x),
      height: Math.abs(br.y - tl.y),
    };
  }, [contentOffsetX, timelineLineY]);

  const displayEntries = useMemo(() => {
    if (!interaction || interaction.mode === 'create') return entries;
    if (interaction.mode !== 'anchor' && interaction.mode !== 'box') return entries;
    if (!interaction.armed) return entries;
    return entries.map((e) => (
      e.id === interaction.entryId
        ? {
          ...e,
          anchor_x: interaction.storedAnchorX,
          end_x: interaction.endX,
          end_y: interaction.endY,
        }
        : e
    ));
  }, [entries, interaction]);

  const timelineLocked = useMemo(
    () => resolvedFolderId != null && isUnderCompletedArchive(notes, resolvedFolderId),
    [notes, resolvedFolderId]
  );

  const showEditTools = canEdit && !timelineLocked;

  const campaignNotes = useMemo(() => {
    if (!resolvedFolderId) return [];
    return notesInCampaignSubtree(notes, resolvedFolderId);
  }, [notes, resolvedFolderId]);

  /**
   * Maps a mouse event to SVG user coordinates via the SVG transform matrix.
   * @param {MouseEvent} e
   * @returns {{ x: number, y: number }|null}
   */
  const eventToSvg = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    return clientPointToSvgUser(svg, e.clientX, e.clientY);
  }, []);

  /**
   * Merges geometry into local entry state (avoids reload jitter after drag).
   * @param {number} entryId
   * @param {number} anchorX
   * @param {number} endX
   * @param {number} endY
   */
  const patchEntryGeometry = useCallback((entryId, anchorX, endX, endY) => {
    setEntries((prev) => prev.map((e) => (
      e.id === entryId ? entryWithGeometry(e, anchorX, endX, endY) : e
    )));
  }, []);

  /**
   * Persists geometry for a timeline entry after anchor or box drag.
   * @param {number} entryId
   * @param {number} anchorX
   * @param {number} endX
   * @param {number} endY
   * @returns {Promise<object>}
   */
  const saveEntryGeometry = useCallback(async (entryId, anchorX, endX, endY) => {
    const path = buildBranchPathToBox(endX, endY);
    const res = await api.put(`/timeline/points/${entryId}`, {
      anchor_x: anchorX,
      end_x: endX,
      end_y: endY,
      path_json: serializeBranchPath(path),
      sort_order: anchorX,
    });
    return res.data;
  }, []);

  /**
   * Adds timeline canvas space toward the past (left).
   */
  const extendPast = useCallback(() => {
    setAxisExtend((e) => ({ ...e, left: e.left + TIMELINE_EXTEND_STEP }));
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft += TIMELINE_EXTEND_STEP;
    });
  }, []);

  /**
   * Adds timeline canvas space toward the present (right).
   */
  const extendPresent = useCallback(() => {
    setAxisExtend((e) => ({ ...e, right: e.right + TIMELINE_EXTEND_STEP }));
  }, []);

  /**
   * Shrinks unused Past/Present padding and pushes any out-of-bounds boxes back onto the canvas.
   * @param {Array<object>} [sourceEntries]
   */
  const trimTimeline = useCallback(async (sourceEntries = entries) => {
    if (busy) return;

    const trimmed = trimAxisExtend(sourceEntries, viewportW, axisExtend);
    const newCanvasWidth = computeCanvasWidth(viewportW, trimmed.left, trimmed.right);
    const adjusted = sourceEntries.map((e) => (
      clampEntryGeometryToCanvas(e, trimmed.left, newCanvasWidth, canvasHeight, timelineLineY)
    ));
    const toSave = adjusted.filter((e, i) => timelineGeometryChanged(e, sourceEntries[i]));
    const extendChanged = trimmed.left !== axisExtend.left || trimmed.right !== axisExtend.right;

    if (!extendChanged && toSave.length === 0) return;

    if (trimmed.leftDelta > 0) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = Math.max(0, scrollRef.current.scrollLeft - trimmed.leftDelta);
        }
      });
    }

    setAxisExtend({ left: trimmed.left, right: trimmed.right });
    setEntries(adjusted);

    if (toSave.length === 0) return;

    setBusy(true);
    wsIgnoreUntilRef.current = Date.now() + 600;
    try {
      const results = await Promise.all(
        toSave.map((e) => saveEntryGeometry(e.id, e.anchor_x, e.end_x, e.end_y))
      );
      setEntries((prev) => prev.map((e) => {
        const updated = results.find((r) => r.id === e.id);
        return updated ? { ...e, ...updated } : e;
      }));
    } catch (err) {
      await loadTimeline();
      alert(err.response?.data?.error || 'Could not save positions after trim');
    } finally {
      setBusy(false);
    }
  }, [entries, viewportW, axisExtend, busy, saveEntryGeometry, loadTimeline, canvasHeight, timelineLineY]);

  /**
   * Loads full note body via GET /notes/:id when the list row omits content.
   * @param {number} noteId
   * @returns {Promise<object>}
   */
  const fetchNoteWithContent = useCallback(async (noteId) => {
    const fromList = notes.find((n) => n.id === noteId);
    if (fromList?.content != null) return fromList;

    const cached = noteContentCacheRef.current[noteId];
    if (cached?.content != null) return cached;

    const res = await api.get(`/notes/${noteId}`);
    const full = { ...(fromList || { id: noteId }), ...res.data };
    noteContentCacheRef.current[noteId] = full;
    return full;
  }, [notes]);

  /**
   * Opens the flyout note reader anchored to the timeline box.
   * @param {object} entry
   * @param {{ left: number, top: number, width: number, height: number }|null} [sourceRect]
   */
  const handleBoxOpen = useCallback(async (entry, sourceRect) => {
    if (!entry?.note_id) return;
    const rect = sourceRect || getBoxScreenRect(entry);
    if (!rect) return;

    const stub = notes.find((n) => n.id === entry.note_id) || { id: entry.note_id };
    setNoteExpand({
      entry,
      note: stub,
      sourceRect: rect,
      noteStack: [entry.note_id],
      loading: true,
      loadError: false,
    });

    try {
      const note = await fetchNoteWithContent(entry.note_id);
      setNoteExpand((prev) => (
        prev?.entry?.id === entry.id
          ? { ...prev, note, loading: false, loadError: false }
          : prev
      ));
    } catch (e) {
      console.error(e);
      setNoteExpand((prev) => (
        prev?.entry?.id === entry.id
          ? { ...prev, loading: false, loadError: true }
          : prev
      ));
    }
  }, [notes, getBoxScreenRect, fetchNoteWithContent]);

  /**
   * Opens the event metadata editor (title, time, linked note).
   * @param {object} entry
   */
  const handleEditEntry = useCallback((entry) => {
    setEditorEntry(entry);
  }, []);

  /**
   * Pushes a referenced note onto the flyout stack and loads its content.
   * @param {number} noteId
   */
  const handleExpandReferenceNote = useCallback(async (noteId) => {
    const numId = Number(noteId);
    if (!Number.isFinite(numId)) return;

    setNoteExpand((prev) => {
      if (!prev) return null;
      const top = prev.noteStack?.[prev.noteStack.length - 1];
      if (top === numId) return { ...prev, loading: true, loadError: false };
      return {
        ...prev,
        noteStack: [...(prev.noteStack || []), numId],
        loading: true,
        loadError: false,
      };
    });

    try {
      const note = await fetchNoteWithContent(numId);
      setNoteExpand((prev) => (
        prev?.noteStack?.[prev.noteStack.length - 1] === numId
          ? { ...prev, note, loading: false, loadError: false }
          : prev
      ));
    } catch (e) {
      console.error(e);
      setNoteExpand((prev) => (
        prev?.noteStack?.[prev.noteStack.length - 1] === numId
          ? { ...prev, loading: false, loadError: true }
          : prev
      ));
    }
  }, [fetchNoteWithContent]);

  /**
   * Pops one level off the flyout note stack and restores the previous note.
   */
  const handleExpandBack = useCallback(async () => {
    let noteIdToLoad = null;
    setNoteExpand((prev) => {
      if (!prev?.noteStack || prev.noteStack.length <= 1) return prev;
      const nextStack = prev.noteStack.slice(0, -1);
      noteIdToLoad = nextStack[nextStack.length - 1];
      return {
        ...prev,
        noteStack: nextStack,
        loading: true,
        loadError: false,
      };
    });

    if (noteIdToLoad == null) return;

    try {
      const note = await fetchNoteWithContent(noteIdToLoad);
      setNoteExpand((prev) => (
        prev?.noteStack?.[prev.noteStack.length - 1] === noteIdToLoad
          ? { ...prev, note, loading: false, loadError: false }
          : prev
      ));
    } catch (e) {
      console.error(e);
      setNoteExpand((prev) => (
        prev?.noteStack?.[prev.noteStack.length - 1] === noteIdToLoad
          ? { ...prev, loading: false, loadError: true }
          : prev
      ));
    }
  }, [fetchNoteWithContent]);

  /**
   * True when a point lies on the interactive timeline axis (for create + hover hint).
   * @param {{ x: number, y: number }} pt
   * @returns {boolean}
   */
  const isOnTimelineAxis = useCallback((pt) => (
    Math.abs(pt.y - timelineLineY) <= LINE_HIT
    && pt.x >= TIMELINE_AXIS_PAD
    && pt.x <= canvasWidth - TIMELINE_AXIS_PAD
  ), [canvasWidth, timelineLineY]);

  /**
   * Starts a new branch drag, pan, or ignores hits on interactive elements.
   * @param {MouseEvent} e
   */
  const handleSvgMouseDown = (e) => {
    if (busy || e.button !== 0 || interaction) return;
    const pt = eventToSvg(e);
    if (!pt) return;

    if (showEditTools && isOnTimelineAxis(pt)) {
      e.preventDefault();
      setInteraction({
        mode: 'create',
        storedAnchorX: toStoredAnchorX(pt.x),
        endX: 0,
        endY: 0,
      });
      return;
    }

    e.preventDefault();
    setInteraction({
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
      armed: false,
    });
  };

  /**
   * Begins dragging an existing anchor along the axis.
   * @param {MouseEvent} e
   * @param {object} entry
   */
  const handleAnchorMouseDown = (e, entry) => {
    if (!showEditTools || busy || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setInteraction({
      mode: 'anchor',
      entryId: entry.id,
      storedAnchorX: entry.anchor_x ?? 0,
      endX: entry.end_x ?? 0,
      endY: entry.end_y ?? -100,
      armed: true,
    });
  };

  /**
   * Arms box drag; opens editor on release if the pointer barely moved.
   * @param {MouseEvent} e
   * @param {object} entry
   */
  const handleBoxMouseDown = (e, entry, sourceRect) => {
    if (!showEditTools || busy || e.button !== 0) return;
    e.stopPropagation();
    const pt = eventToSvg(e);
    if (!pt) return;
    pointerStartRef.current = {
      x: pt.x,
      y: pt.y,
      entryId: entry.id,
      sourceRect: sourceRect || getBoxScreenRect(entry),
    };
    setInteraction({
      mode: 'box',
      entryId: entry.id,
      storedAnchorX: entry.anchor_x ?? 0,
      endX: entry.end_x ?? 0,
      endY: entry.end_y ?? -100,
      armed: false,
    });
  };

  /**
   * Updates axis hover hint and handles active drag interactions.
   * @param {MouseEvent} e
   */
  const handleSvgMouseMove = (e) => {
    const pt = eventToSvg(e);
    if (pt) {
      if (!interaction && showEditTools && isOnTimelineAxis(pt)) {
        setAxisHover({ x: pt.x });
      } else if (!interaction) {
        setAxisHover(null);
      }
    }

    if (!interaction) return;
    if (!pt) return;

    if (interaction.mode === 'create') {
      const displayAx = toDisplayX(interaction.storedAnchorX);
      const clamped = clampBoxOffsets(
        displayAx,
        pt.x - displayAx,
        pt.y - timelineLineY,
        canvasWidth,
        canvasHeight,
        timelineLineY,
      );
      setInteraction((prev) => ({
        ...prev,
        endX: clamped.endX,
        endY: clamped.endY,
      }));
      return;
    }

    if (interaction.mode === 'anchor') {
      const clampedX = clampAnchorDisplayX(pt.x, interaction.endX, canvasWidth);
      setInteraction((d) => ({
        ...d,
        storedAnchorX: toStoredAnchorX(clampedX),
        armed: true,
      }));
      return;
    }

    if (interaction.mode === 'box') {
      const start = pointerStartRef.current;
      const dist = start
        ? Math.hypot(pt.x - start.x, pt.y - start.y)
        : TIMELINE_CLICK_THRESHOLD + 1;
      const armed = dist >= TIMELINE_CLICK_THRESHOLD;
      const displayAx = toDisplayX(interaction.storedAnchorX);
      const rawEndX = pt.x - displayAx;
      const rawEndY = pt.y - timelineLineY;
      const clamped = clampBoxOffsets(displayAx, rawEndX, rawEndY, canvasWidth, canvasHeight, timelineLineY);
      setInteraction((d) => ({
        ...d,
        armed,
        endX: clamped.endX,
        endY: clamped.endY,
      }));
      return;
    }

    if (interaction.mode === 'pan') {
      const dx = e.clientX - interaction.startX;
      const dy = e.clientY - interaction.startY;
      const armed = interaction.armed || Math.hypot(dx, dy) >= TIMELINE_CLICK_THRESHOLD;
      const scale = getRootTextScale();
      if (scrollRef.current && armed) {
        scrollRef.current.scrollLeft = interaction.scrollLeft - dx / scale;
      }
      if (!interaction.armed && armed) {
        setInteraction((d) => ({ ...d, armed: true }));
      }
    }
  };

  /**
   * Finishes create drag, reposition drag, or treats box press as click.
   */
  const finishInteraction = useCallback(async () => {
    const current = interactionRef.current;
    if (!current || !resolvedFolderId) {
      setInteraction(null);
      pointerStartRef.current = null;
      return;
    }

    interactionRef.current = null;
    setInteraction(null);

    if (current.mode === 'create') {
      const { storedAnchorX, endX, endY } = current;
      if (Math.hypot(endX, endY) < TIMELINE_MIN_BRANCH) return;

      const path = buildBranchPathToBox(endX, endY);
      setBusy(true);
      try {
        const res = await api.post('/timeline/points', {
          folder_id: resolvedFolderId,
          anchor_x: storedAnchorX,
          end_x: endX,
          end_y: endY,
          path_json: serializeBranchPath(path),
        });
        setEntries((prev) => [...prev, res.data]);
        wsIgnoreUntilRef.current = Date.now() + 600;
        setEditorEntry(res.data);
      } catch (err) {
        alert(err.response?.data?.error || 'Could not place event');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (current.mode === 'anchor' && current.armed) {
      const { entryId, storedAnchorX, endX, endY } = current;
      patchEntryGeometry(entryId, storedAnchorX, endX, endY);
      wsIgnoreUntilRef.current = Date.now() + 600;
      try {
        const updated = await saveEntryGeometry(entryId, storedAnchorX, endX, endY);
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...updated } : e)));
      } catch (err) {
        await loadTimeline();
        alert(err.response?.data?.error || 'Could not move anchor');
      }
      return;
    }

    if (current.mode === 'box') {
      const entry = entries.find((en) => en.id === current.entryId);
      if (current.armed) {
        const { entryId, storedAnchorX, endX, endY } = current;
        patchEntryGeometry(entryId, storedAnchorX, endX, endY);
        wsIgnoreUntilRef.current = Date.now() + 600;
        try {
          const updated = await saveEntryGeometry(entryId, storedAnchorX, endX, endY);
          setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...updated } : e)));
        } catch (err) {
          await loadTimeline();
          alert(err.response?.data?.error || 'Could not move event');
        }
      } else if (entry) {
        handleBoxOpen(entry, pointerStartRef.current?.sourceRect);
      }
      pointerStartRef.current = null;
      return;
    }

    if (current.mode === 'pan') {
      return;
    }
  }, [resolvedFolderId, loadTimeline, saveEntryGeometry, patchEntryGeometry, entries, handleBoxOpen]);

  useEffect(() => {
    if (!interaction) return undefined;
    const onUp = () => { finishInteraction(); };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [interaction, finishInteraction]);

  /**
   * Persists display title, time label, and linked note for an event box.
   * @param {number} entryId
   * @param {{ noteId: number|null, displayTitle: string, timeLabel: string }} payload
   */
  const handleSaveEvent = async (entryId, { noteId, displayTitle, timeLabel }) => {
    setBusy(true);
    try {
      await api.put(`/timeline/points/${entryId}`, {
        note_id: noteId,
        label_override: displayTitle.trim() || null,
        time_label: timeLabel.trim(),
      });
      setEditorEntry(null);
      await loadTimeline();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not save event');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Removes a box from the timeline after confirmation.
   * @param {number} entryId
   */
  const handleDeleteEntry = async (entryId) => {
    if (!window.confirm('Remove this event from the timeline?')) return;
    setBusy(true);
    try {
      await api.delete(`/timeline/points/${entryId}`);
      setEditorEntry(null);
      await loadTimeline();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not remove event');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Opens the linked-note flyout for players (read-only timeline).
   * @param {object} entry
   */
  const handlePlayerBoxOpen = (entry) => {
    handleBoxOpen(entry, getBoxScreenRect(entry));
  };

  /**
   * Resolves category color for a timeline entry (placeholder → general).
   * @param {object} entry
   * @returns {string}
   */
  const entryColor = (entry) => getCategoryColor(entry.note_category || 'general');

  const createInteraction = interaction?.mode === 'create' ? interaction : null;
  const createPath = createInteraction ? buildBranchPathToBox(createInteraction.endX, createInteraction.endY) : null;
  const createDisplayAx = createInteraction ? toDisplayX(createInteraction.storedAnchorX) : 0;

  if (campaignRoots.length === 0) {
    return (
      <div style={{ padding: '24px', fontFamily: 'var(--ch-font-body)', color: 'var(--ch-text-primary-45)' }}>
        No playable campaigns yet. Create a campaign folder to build a timeline.
      </div>
    );
  }

  return (
    <div ref={tutorialRefs?.shell || null} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--ch-shell-bg)', overflow: 'hidden' }}>
      <div style={headerStyle}>
        <span style={headerLabelStyle}>CAMPAIGN</span>
        <select
          ref={tutorialRefs?.campaignPicker || null}
          value={resolvedFolderId ?? ''}
          onChange={(e) => setActiveFolderId(e.target.value ? parseInt(e.target.value, 10) : null)}
          disabled={tutorialCampaignId != null}
          style={selectStyle}
        >
          {campaignRoots.map((f) => (
            <option key={f.id} value={f.id}>{f.title || 'Untitled'}</option>
          ))}
        </select>
        <span style={hintStyle}>
          {showEditTools
            ? 'Drag empty space to pan; Past / Present add space (hold Shift on hover to trim)'
            : 'Drag empty space to pan along the timeline'}
        </span>
        {timelineLocked && (
          <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', color: 'rgba(200,148,58,0.5)' }}>
            Archived — read only
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '24px', fontFamily: 'var(--ch-font-display)', fontSize: '10px', color: 'rgba(200,148,58,0.45)', letterSpacing: '0.12em' }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: '24px', fontFamily: 'var(--ch-font-body)', color: 'rgba(220,100,100,0.85)' }}>{error}</div>
        ) : (
          <svg
            ref={(el) => {
              svgRef.current = el;
              if (tutorialRefs?.canvas) tutorialRefs.canvas.current = el;
            }}
            width={canvasWidth}
            height={canvasHeight}
            style={{
              display: 'block',
              flexShrink: 0,
              cursor: interaction?.mode === 'pan' && interaction.armed
                ? 'grabbing'
                : interaction
                  ? 'grabbing'
                  : 'default',
              userSelect: 'none',
            }}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseLeave={() => setAxisHover(null)}
          >
            <line
              x1={TIMELINE_AXIS_PAD}
              y1={timelineLineY}
              x2={canvasWidth - TIMELINE_AXIS_PAD}
              y2={timelineLineY}
              stroke="transparent"
              strokeWidth={LINE_HIT * 2}
            />
            <line
              x1={TIMELINE_AXIS_PAD}
              y1={timelineLineY}
              x2={canvasWidth - TIMELINE_AXIS_PAD}
              y2={timelineLineY}
              stroke="rgba(200,148,58,0.65)"
              strokeWidth={3}
              strokeLinecap="round"
            />

            {axisHover && showEditTools && !interaction && (
              <g pointerEvents="none">
                <text
                  x={axisHover.x}
                  y={timelineLineY - 22}
                  textAnchor="middle"
                  fill="rgba(200,148,58,0.8)"
                  fontFamily="var(--ch-font-display)"
                  fontSize="9"
                  letterSpacing="0.12em"
                >
                  Click and drag to add point
                </text>
              </g>
            )}

            <TimelineAxisLabel
              hitX={TIMELINE_AXIS_PAD}
              hitY={timelineLineY + 14}
              hitW={AXIS_LABEL_HIT_W}
              hitH={AXIS_LABEL_HIT_H}
              label="< Past"
              trimLabel="Trim"
              shiftHeld={shiftHeld}
              onClick={showEditTools ? (e) => (e.shiftKey ? trimTimeline() : extendPast()) : undefined}
            />
            <TimelineAxisLabel
              hitX={canvasWidth - TIMELINE_AXIS_PAD - AXIS_LABEL_HIT_W}
              hitY={timelineLineY + 14}
              hitW={AXIS_LABEL_HIT_W}
              hitH={AXIS_LABEL_HIT_H}
              label="Present >"
              trimLabel="Trim"
              shiftHeld={shiftHeld}
              onClick={showEditTools ? (e) => (e.shiftKey ? trimTimeline() : extendPresent()) : undefined}
            />

            {displayEntries.map((entry) => (
              <TimelineEntryGraphic
                key={entry.id}
                entry={entry}
                contentOffsetX={contentOffsetX}
                categoryColor={entryColor(entry)}
                canEdit={showEditTools}
                lineY={timelineLineY}
                onBoxOpen={() => handlePlayerBoxOpen(entry)}
                onEdit={() => handleEditEntry(entry)}
                onAnchorMouseDown={(e) => handleAnchorMouseDown(e, entry)}
                onBoxMouseDown={(e, rect) => handleBoxMouseDown(e, entry, rect)}
                onDelete={() => handleDeleteEntry(entry.id)}
              />
            ))}

            {createInteraction && createPath && (
              <g opacity={0.85}>
                <polyline
                  points={pathToSvgPoints(createDisplayAx, timelineLineY, createPath)}
                  fill="none"
                  stroke="rgba(200,148,58,0.55)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                <circle cx={createDisplayAx} cy={timelineLineY} r={5} fill="#c8943a" />
                <TimelineBoxGraphic
                  cx={createDisplayAx + createInteraction.endX}
                  cy={timelineLineY + createInteraction.endY}
                  placeholder
                  categoryColor={getCategoryColor('general')}
                  title="…"
                  time=""
                />
              </g>
            )}
          </svg>
        )}
      </div>

      {noteExpand && (
        <TimelineNoteExpand
          entry={noteExpand.entry}
          note={noteExpand.note}
          sourceRect={noteExpand.sourceRect}
          loading={!!noteExpand.loading}
          loadError={!!noteExpand.loadError}
          canGoBack={(noteExpand.noteStack?.length ?? 0) > 1}
          getSourceRect={() => getBoxScreenRect(noteExpand.entry)}
          onBack={handleExpandBack}
          onClose={() => setNoteExpand(null)}
          onOpenReferenceNote={handleExpandReferenceNote}
        />
      )}

      {editorEntry && (
        <TimelineEventEditor
          entry={editorEntry}
          campaignNotes={campaignNotes}
          busy={busy}
          onSave={(payload) => handleSaveEvent(editorEntry.id, payload)}
          onDelete={() => handleDeleteEntry(editorEntry.id)}
          onClose={() => !busy && setEditorEntry(null)}
        />
      )}
    </div>
  );
}

/**
 * Clickable Past / Present control with a fixed hit area; shows "Trim" when Shift is held on hover.
 * @param {{
 *   hitX: number,
 *   hitY: number,
 *   hitW: number,
 *   hitH: number,
 *   label: string,
 *   trimLabel?: string,
 *   shiftHeld?: boolean,
 *   onClick?: (e: MouseEvent) => void,
 * }} props
 */
function TimelineAxisLabel({
  hitX,
  hitY,
  hitW,
  hitH,
  label,
  trimLabel = 'Trim',
  shiftHeld = false,
  onClick,
}) {
  const [hovered, setHovered] = useState(false);
  const interactive = !!onClick;
  const displayLabel = shiftHeld && hovered ? trimLabel : label;
  const textX = hitX + hitW / 2;
  const textY = hitY + hitH / 2 + 4;

  return (
    <g
      style={{ cursor: interactive ? 'pointer' : 'default' }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <rect
        x={hitX}
        y={hitY}
        width={hitW}
        height={hitH}
        rx={4}
        fill={interactive && hovered ? 'rgba(200,148,58,0.08)' : 'transparent'}
        stroke={interactive && hovered ? 'rgba(200,148,58,0.28)' : 'transparent'}
        strokeWidth={1}
      />
      <text
        x={textX}
        y={textY}
        textAnchor="middle"
        fill={interactive
          ? (shiftHeld && hovered ? 'rgba(220,170,90,0.95)' : 'rgba(200,148,58,0.75)')
          : 'rgba(200,148,58,0.4)'}
        fontFamily="var(--ch-font-display)"
        fontSize="10"
        letterSpacing="0.14em"
        style={{ pointerEvents: 'none' }}
      >
        {displayLabel}
      </text>
    </g>
  );
}

/**
 * Renders branch + box for one saved timeline entry.
 * @param {{
 *   entry: object,
 *   contentOffsetX: number,
 *   categoryColor: string,
 *   canEdit: boolean,
 *   lineY: number,
 *   onBoxOpen: () => void,
 *   onEdit: () => void,
 *   onAnchorMouseDown: (e: MouseEvent) => void,
 *   onBoxMouseDown: (e: MouseEvent, sourceRect: DOMRect | null) => void,
 *   onDelete: () => void,
 * }} props
 */
function TimelineEntryGraphic({
  entry,
  contentOffsetX,
  categoryColor,
  lineY,
  canEdit,
  onBoxOpen,
  onEdit,
  onAnchorMouseDown,
  onBoxMouseDown,
  onDelete,
}) {
  const ax = (entry.anchor_x ?? 0) + contentOffsetX;
  const ex = entry.end_x ?? 0;
  const ey = entry.end_y ?? -100;
  const path = parseBranchPath(entry.path_json, ex, ey);
  const cx = ax + ex;
  const cy = lineY + ey;
  const stroke = hexToRgba(categoryColor, 0.85);

  return (
    <g>
      <polyline
        points={pathToSvgPoints(ax, lineY, path)}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
      />
      <circle
        cx={ax}
        cy={lineY}
        r={ANCHOR_HIT_R}
        fill="transparent"
        style={{ cursor: canEdit ? 'grab' : 'default' }}
        onMouseDown={canEdit ? onAnchorMouseDown : undefined}
      />
      <circle
        cx={ax}
        cy={lineY}
        r={5}
        fill={categoryColor}
        stroke="#07080e"
        strokeWidth={1.5}
        style={{ pointerEvents: 'none' }}
      />
      <TimelineBoxGraphic
        cx={cx}
        cy={cy}
        placeholder={!!entry.is_placeholder}
        categoryColor={categoryColor}
        title={timelineBoxTitle(entry)}
        time={entry.time_label || ''}
        canEdit={canEdit}
        onOpen={onBoxOpen}
        onMouseDown={(e, sourceRect) => onBoxMouseDown(e, sourceRect)}
      />
      {canEdit && (
        <g
          style={{ cursor: 'pointer' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <circle cx={cx - TIMELINE_BOX_W / 2 + 6} cy={cy - TIMELINE_BOX_H / 2 + 6} r={9} fill="var(--ch-card-bg)" stroke={hexToRgba(categoryColor, 0.5)} />
          <text
            x={cx - TIMELINE_BOX_W / 2 + 6}
            y={cy - TIMELINE_BOX_H / 2 + 10}
            textAnchor="middle"
            fill="var(--ch-text-primary-65)"
            fontSize="10"
            style={{ pointerEvents: 'none' }}
          >
            ✎
          </text>
        </g>
      )}
      {canEdit && (
        <g
          style={{ cursor: 'pointer' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <circle cx={cx + TIMELINE_BOX_W / 2 - 6} cy={cy - TIMELINE_BOX_H / 2 + 6} r={9} fill="var(--ch-card-bg)" stroke={hexToRgba(categoryColor, 0.5)} />
          <text
            x={cx + TIMELINE_BOX_W / 2 - 6}
            y={cy - TIMELINE_BOX_H / 2 + 10}
            textAnchor="middle"
            fill="var(--ch-text-primary-55)"
            fontSize="12"
            style={{ pointerEvents: 'none' }}
          >
            ×
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * Event box centered at (cx, cy) with wrapped title and optional time label.
 * @param {{
 *   cx: number,
 *   cy: number,
 *   placeholder?: boolean,
 *   categoryColor: string,
 *   title: string,
 *   time?: string,
 *   canEdit?: boolean,
 *   onOpen?: () => void,
 *   onMouseDown?: (e: MouseEvent, sourceRect: DOMRect | null) => void,
 * }} props
 */
function TimelineBoxGraphic({
  cx,
  cy,
  placeholder,
  categoryColor,
  title,
  time,
  canEdit,
  onOpen,
  onMouseDown,
}) {
  const x = cx - TIMELINE_BOX_W / 2;
  const y = cy - TIMELINE_BOX_H / 2;
  const fill = hexToRgba(categoryColor, placeholder ? 0.08 : 0.14);
  const stroke = hexToRgba(categoryColor, placeholder ? 0.55 : 0.9);

  return (
    <g
      style={{ cursor: canEdit ? 'grab' : (onOpen ? 'pointer' : 'default') }}
      onClick={!canEdit ? (e) => { e.stopPropagation(); onOpen?.(); } : undefined}
      onMouseDown={(e) => {
        e.stopPropagation();
        const rectEl = e.currentTarget.querySelector('rect[data-timeline-box]');
        const sourceRect = rectEl?.getBoundingClientRect() ?? null;
        onMouseDown?.(e, sourceRect);
      }}
    >
      <rect
        data-timeline-box
        x={x}
        y={y}
        width={TIMELINE_BOX_W}
        height={TIMELINE_BOX_H}
        rx={4}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={placeholder ? '6 4' : undefined}
      />
      <foreignObject x={x} y={y} width={TIMELINE_BOX_W} height={TIMELINE_BOX_H}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ch-font-body)',
              fontSize: '13px',
              lineHeight: 1.3,
              color: placeholder ? 'var(--ch-text-primary-45)' : 'var(--ch-text-primary)',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              width: '100%',
              maxHeight: time ? '58%' : '100%',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
          {time ? (
            <div
              style={{
                fontFamily: 'var(--ch-font-display)',
                fontSize: '9px',
                letterSpacing: '0.06em',
                color: hexToRgba(categoryColor, 0.95),
                marginTop: '4px',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                width: '100%',
                lineHeight: 1.25,
                maxHeight: '42%',
                overflow: 'hidden',
              }}
            >
              {time}
            </div>
          ) : null}
        </div>
      </foreignObject>
    </g>
  );
}

/**
 * Modal to set display title, time label, and linked campaign note (grouped + search).
 * @param {{
 *   entry: object,
 *   campaignNotes: object[],
 *   busy: boolean,
 *   onSave: (payload: { noteId: number|null, displayTitle: string, timeLabel: string }) => void,
 *   onDelete: () => void,
 *   onClose: () => void,
 * }} props
 */
function TimelineEventEditor({ entry, campaignNotes, busy, onSave, onDelete, onClose }) {
  const defaultTitle = entry.label_override
    || entry.note_title
    || '';
  const [displayTitle, setDisplayTitle] = useState(defaultTitle);
  const [timeLabel, setTimeLabel] = useState(entry.time_label || '');
  const [noteId, setNoteId] = useState(entry.note_id ?? null);
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => groupNotesByCategory(campaignNotes, search), [campaignNotes, search]);

  /**
   * Submits the event editor form.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ noteId, displayTitle, timeLabel });
  };

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={{ ...modalPanelStyle, maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div style={modalTitleStyle}>Timeline event</div>
        <form onSubmit={handleSubmit}>
          <label style={fieldLabelStyle}>
            Display title
            <input
              type="text"
              value={displayTitle}
              onChange={(e) => setDisplayTitle(e.target.value)}
              placeholder={entry.note_title || 'Title on the timeline'}
              style={inputStyle}
              disabled={busy}
            />
          </label>

          <label style={{ ...fieldLabelStyle, marginTop: '14px' }}>
            Time
            <input
              type="text"
              value={timeLabel}
              onChange={(e) => setTimeLabel(e.target.value)}
              placeholder='e.g. "Year 1420", "3 sessions ago", "Before the fall"'
              style={inputStyle}
              disabled={busy}
            />
          </label>

          <div style={{ ...fieldLabelStyle, marginTop: '16px' }}>Linked note</div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            style={{ ...inputStyle, marginTop: '6px' }}
            disabled={busy}
          />

          <div style={{ marginTop: '12px', maxHeight: '36vh', overflow: 'auto' }}>
            {grouped.length === 0 ? (
              <p style={{ fontFamily: 'var(--ch-font-body)', color: 'var(--ch-text-primary-45)', margin: 0, fontSize: '14px' }}>
                {campaignNotes.length === 0 ? 'No notes in this campaign.' : 'No notes match your search.'}
              </p>
            ) : (
              grouped.map((group) => (
                <div key={group.value} style={{ marginBottom: '14px' }}>
                  <div
                    style={{
                      fontFamily: 'var(--ch-font-display)',
                      fontSize: '8px',
                      letterSpacing: '0.14em',
                      color: getCategoryColor(group.value),
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {group.label}
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {group.notes.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setNoteId(n.id);
                            if (!displayTitle.trim()) setDisplayTitle(n.title || '');
                          }}
                          style={{
                            ...notePickRowStyle,
                            background: noteId === n.id ? 'rgba(200,148,58,0.12)' : 'transparent',
                            borderLeft: `3px solid ${getCategoryColor(n.category || 'general')}`,
                            paddingLeft: '10px',
                          }}
                        >
                          {n.title || 'Untitled'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy} style={toolbarBtnStyle}>Save</button>
            <button type="button" disabled={busy} onClick={onClose} style={toolbarBtnStyle}>Cancel</button>
            {noteId != null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setNoteId(null)}
                style={{ ...toolbarBtnStyle, marginLeft: 'auto' }}
              >
                Clear note
              </button>
            )}
            <button type="button" disabled={busy} onClick={onDelete} style={{ ...toolbarBtnStyle, color: 'rgba(220,120,100,0.9)' }}>
              Delete event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const headerStyle = {
  flexShrink: 0,
  padding: '12px 20px',
  borderBottom: '1px solid var(--ch-border)',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const headerLabelStyle = {
  fontFamily: 'var(--ch-font-display)',
  fontSize: '9px',
  letterSpacing: '0.18em',
  color: 'rgba(200,148,58,0.55)',
};

const selectStyle = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(200,148,58,0.25)',
  borderRadius: '4px',
  color: 'var(--ch-text-primary)',
  fontFamily: 'var(--ch-font-display)',
  fontSize: '11px',
  padding: '8px 12px',
  minWidth: '200px',
  cursor: 'pointer',
};

const hintStyle = {
  fontFamily: 'var(--ch-font-display)',
  fontSize: '8px',
  letterSpacing: '0.12em',
  color: 'var(--ch-text-primary-35)',
};

const toolbarBtnStyle = {
  background: 'rgba(200,148,58,0.12)',
  border: '1px solid rgba(200,148,58,0.35)',
  borderRadius: '4px',
  color: 'var(--ch-text-primary)',
  fontFamily: 'var(--ch-font-display)',
  fontSize: '10px',
  letterSpacing: '0.1em',
  padding: '8px 12px',
  cursor: 'pointer',
};

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9000,
  padding: '16px',
};

const modalPanelStyle = {
  background: 'var(--ch-card-bg)',
  border: '1px solid rgba(200,148,58,0.25)',
  borderRadius: '6px',
  padding: '20px',
  width: '100%',
  maxHeight: '85vh',
  overflow: 'auto',
};

const modalTitleStyle = {
  fontFamily: 'var(--ch-font-display)',
  fontSize: '11px',
  color: 'var(--ch-accent)',
  marginBottom: '16px',
  letterSpacing: '0.12em',
};

const fieldLabelStyle = {
  display: 'block',
  fontFamily: 'var(--ch-font-display)',
  fontSize: '9px',
  letterSpacing: '0.12em',
  color: 'rgba(200,148,58,0.55)',
};

const inputStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: '6px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(200,148,58,0.25)',
  borderRadius: '4px',
  color: 'var(--ch-text-primary)',
  fontFamily: 'var(--ch-font-body)',
  fontSize: '15px',
  padding: '10px 12px',
};

const notePickRowStyle = {
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  color: 'var(--ch-text-primary)',
  fontFamily: 'var(--ch-font-body)',
  fontSize: '15px',
  padding: '8px 4px',
  cursor: 'pointer',
};
