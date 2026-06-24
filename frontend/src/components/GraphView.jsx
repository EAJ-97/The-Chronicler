import { useEffect, useRef, useState, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import cytoscape from 'cytoscape';
import { getCategoryColor } from './NoteEditor.jsx';
import GraphView3D from './GraphView3D.jsx';
import GraphSigmaBench, { isSigmaBenchEnabled } from './GraphSigmaBench.jsx';
import GraphDevTools from './GraphDevTools.jsx';
import { useDevGraphToolsEnabled } from '../utils/useDevGraphToolsEnabled.js';
import { generateBenchmarkGraph } from '../graph/spike/generateFixture.js';
import {
  BENCH_FIXTURE_POS_KEY,
  loadDevScoreThreshold,
  saveDevScoreThreshold,
  effectiveGraphScoreThreshold,
} from '../graph/devGraphTools.js';
import api from '../api.js';
import { getGraphCampaignRoots, isUnderCompletedArchive } from '../utils/campaignTree.js';
import {
  HOP_OPACITY,
  FLOOR_OPACITY,
  PATH_FIND_PICK_DIM_OPACITY,
  MAX_HOPS,
  HOVER_HIGHLIGHT_MAX_NODES,
  HOVER_DELAY_MS,
  HOVER_TRANSITION_MS,
  GRAPH_MIN_ZOOM,
  GRAPH_MAX_ZOOM,
  GRAPH_PIXEL_RATIO_CAP,
  LARGE_GRAPH_SCORE_THRESHOLD,
} from '../graph/constants.js';
import {
  DEFAULT_EDGE_THEME,
  EDGE_KIND_META,
  hexToRgba,
} from '../graph/connections.js';
import { useTheme } from '../theme/useTheme.js';
import {
  buildCanonAdjacency,
  getTiersFromAdj,
  getAllShortestPaths,
} from '../graph/adjacency.js';
import {
  loadGraphNodeIdSet,
  saveGraphNodeIdSet,
} from '../graph/storage.js';
import { computeGraphLod, zoomPerformanceZone } from '../graph/lod.js';
import { buildGraphFingerprint, buildElements } from '../graph/elements.js';
import {
  selectGraphRenderer,
  loadRendererPref,
  saveRendererPref,
  graphSizeScore,
  resolveAutoRenderer,
} from '../graph/selectRenderer.js';
import { paintZoomHud as paintZoomHudDom } from '../graph/paintZoomHud.js';

const GraphView2DWebGL = lazy(() => import('./GraphView2DWebGL.jsx'));

function useContainerWidth(ref) {
  const [width, setWidth] = useState(9999);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Tier / path / connect classes cleared incrementally instead of scanning all elements. */
const HIGHLIGHT_CLASS_LIST = ['tier-0', 'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-6', 'dimmed', 'highlighted', 'path-node', 'path-edge', 'path-floor', 'path-pick-dim', 'connect-source', 'connect-dim', 'theory-source', 'ship-source', 'new-highlight', 'new-highlight-flash'];
const HIGHLIGHT_CLASSES = HIGHLIGHT_CLASS_LIST.join(' ');

/**
 * Removes highlight classes only from elements that were previously styled.
 * @param {import('cytoscape').Core} cy
 * @param {{ current: { touched: import('cytoscape').CollectionReturnValue|null } }} highlightStateRef
 */
function clearHighlightClasses(cy, highlightStateRef) {
  const touched = highlightStateRef?.current?.touched;
  if (touched && touched.length) {
    touched.removeClass(HIGHLIGHT_CLASSES);
    highlightStateRef.current.touched = null;
  }
}

/**
 * Applies tier-based hover/selection styling in a single batched pass; tracks touched elements.
 * @param {import('cytoscape').Core} cy
 * @param {Map<string, number>} tiers
 * @param {number} maxDepth
 * @param {{ current: { touched: import('cytoscape').CollectionReturnValue|null } }} highlightStateRef
 */
function applyTierHighlight(cy, tiers, maxDepth, highlightStateRef) {
  clearHighlightClasses(cy, highlightStateRef);
  let touched = cy.collection();
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const t = tiers.get(n.id());
      if (t === undefined) n.addClass('dimmed');
      else n.addClass(`tier-${Math.min(t, maxDepth)}`);
      touched = touched.union(n);
    });
    cy.edges().forEach((edge) => {
      if (edge.hasClass('kind-theory') || edge.hasClass('kind-ship')) {
        const sT = tiers.get(edge.source().id()) ?? Infinity;
        const tT = tiers.get(edge.target().id()) ?? Infinity;
        if (sT === Infinity || tT === Infinity) edge.addClass('dimmed');
        else edge.addClass('highlighted');
      } else {
        const sT = tiers.get(edge.source().id()) ?? Infinity;
        const tT = tiers.get(edge.target().id()) ?? Infinity;
        if (sT === Infinity || tT === Infinity) edge.addClass('dimmed');
        else edge.addClass(`tier-${Math.min(Math.max(sT, tT), maxDepth)}`);
      }
      touched = touched.union(edge);
    });
  });
  highlightStateRef.current.touched = touched;
}

/**
 * Returns all note ids in a folder subtree (inclusive of the root folder id).
 * @param {object[]} allNotes
 * @param {number} rootId
 * @returns {Set<number>}
 */
function getSubtreeIds(allNotes, rootId) {
  const childrenOf = new Map();
  for (const n of allNotes) {
    const pid = n.parent_id;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(n.id);
  }
  const ids = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    ids.add(id);
    for (const cid of (childrenOf.get(id) || [])) queue.push(cid);
  }
  return ids;
}

/**
 * Counts nodes whose centers fall inside the current graph viewport (FPS HUD diagnostic).
 * @param {import('cytoscape').Core} cy
 * @returns {number}
 */
function countNodesInViewport(cy) {
  const ext = cy.extent();
  let n = 0;
  cy.nodes().forEach((node) => {
    const p = node.position();
    if (p.x >= ext.x1 && p.x <= ext.x2 && p.y >= ext.y1 && p.y <= ext.y2) n += 1;
  });
  return n;
}

/**
 * Applies far-zoom label culling only — all labels stay visible at normal zoom levels.
 * @param {import('cytoscape').Core} cy
 * @param {{ edgeLabelsHidden: boolean, nodeLabelsHidden: boolean }} lodState
 */
function updateGraphLod(cy, lodState) {
  const { hideEdgeLabels, hideNodeLabels } = computeGraphLod(cy.zoom(), cy.nodes().length);
  if (hideEdgeLabels !== lodState.edgeLabelsHidden) {
    lodState.edgeLabelsHidden = hideEdgeLabels;
    cy.edges().toggleClass('no-edge-labels', hideEdgeLabels);
  }
  if (hideNodeLabels !== lodState.nodeLabelsHidden) {
    lodState.nodeLabelsHidden = hideNodeLabels;
    cy.nodes().toggleClass('no-node-labels', hideNodeLabels);
  }
}

/**
 * Toggles a gold flash class on new-highlight nodes until interval is cleared.
 * @param {import('cytoscape').Core} cy
 * @param {{ current: ReturnType<typeof setInterval>|null }} flashRef
 */
function startNewHighlightFlash(cy, flashRef) {
  if (flashRef.current) clearInterval(flashRef.current);
  let on = false;
  flashRef.current = setInterval(() => {
    on = !on;
    cy.nodes('.new-highlight').toggleClass('new-highlight-flash', on);
  }, 550);
}

/**
 * Stops the gold flash interval and clears flash styling on new nodes.
 * @param {{ current: ReturnType<typeof setInterval>|null }} flashRef
 * @param {import('cytoscape').Core|null} [cy]
 */
function stopNewHighlightFlash(flashRef, cy = null) {
  if (flashRef.current) clearInterval(flashRef.current);
  flashRef.current = null;
  cy?.nodes().removeClass('new-highlight-flash');
}

/**
 * Pushes cytoscape viewport stats into the shared zoom HUD DOM.
 * @param {HTMLElement|null} el
 * @param {import('cytoscape').Core|null} cy
 */
function paintZoomHud(el, cy) {
  if (!el || !cy) return;
  paintZoomHudDom(el, {
    zoom: cy.zoom(),
    nodes: cy.nodes().length,
    edges: cy.edges().length,
    engine: 'standard (Cytoscape)',
    visibleInView: countNodesInViewport(cy),
  });
}

const NODE_TRANSITION_PROPS = 'opacity, width, height, border-width, background-opacity, border-opacity, font-size';
const EDGE_TRANSITION_PROPS = 'opacity, width, line-opacity';

/**
 * Enables/disables Cytoscape style transitions — must be off during pan/zoom or every frame interpolates the whole graph.
 * @param {import('cytoscape').Core} cy
 * @param {boolean} enabled
 */
function setGraphStyleTransitions(cy, enabled) {
  const dur = enabled ? `${HOVER_TRANSITION_MS}ms` : '0ms';
  const nodeProp = enabled ? NODE_TRANSITION_PROPS : 'none';
  const edgeProp = enabled ? EDGE_TRANSITION_PROPS : 'none';
  cy.style()
    .selector('node')
    .style({
      'transition-property': nodeProp,
      'transition-duration': dur,
      'transition-timing-function': 'ease-in-out',
    })
    .selector('edge')
    .style({
      'transition-property': edgeProp,
      'transition-duration': dur,
      'transition-timing-function': 'ease-in-out',
    })
    .update();
}

export default memo(function GraphView({ allNotes, notes, connections, onSelectNote, onOpenNote, onCreateConnection, onDeleteConnection, onUpdateConnection, selectedNoteId, currentUser, dmCampaignIds, simulatedRole, isMobile, tutorialRefs = null, tutorialForce3D = false, tutorialForce2D = false, tutorialForceToolMenu = false }) {
  const { theme } = useTheme();
  const edgeTheme = theme.edges;
  const devGraphToolsEnabled = useDevGraphToolsEnabled();
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  /** WebGL sigma adapter instance when performance map is active. */
  const sigmaRendererRef = useRef(null);
  const hoverTimerRef = useRef(null);
  /** True while panning the background or dragging a node — blocks hover tier preview. */
  const suppressHoverRef = useRef(false);
  const isFirstMount = useRef(true);
  /** Skips redundant Cytoscape patches when parent re-renders with the same graph data. */
  const dataFingerprintRef = useRef('');
  /** Precomputed canon adjacency — avoids per-hop Cytoscape edge queries during hover/path/selection. */
  const canonAdjRef = useRef(new Map());
  /** Tracks elements that received highlight classes for incremental clear. */
  const highlightStateRef = useRef({ touched: null });
  /** Avoids re-centering animation when selection id is unchanged. */
  const lastCenteredRef = useRef(null);
  /** Zoom HUD overlay root — updated on viewport without React state. */
  const zoomHudRef = useRef(null);
  /** Latest paintZoomHud callback from the Cytoscape mount effect. */
  const paintZoomHudRef = useRef(() => {});
  /** Stable handler bag — bindEvents reads .current so listeners are never rebound on data updates. */
  const graphHandlersRef = useRef({});
  const zoomHudKey = `chronicler_graph_zoom_hud_${currentUser?.id || 'anon'}`;
  const [showZoomHud, setShowZoomHudRaw] = useState(() => {
    try {
      const stored = localStorage.getItem(zoomHudKey);
      if (stored === null) return true;
      return stored === 'true';
    } catch { return true; }
  });
  const setShowZoomHud = useCallback((val) => {
    setShowZoomHudRaw((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { localStorage.setItem(zoomHudKey, String(next)); } catch (e) {}
      requestAnimationFrame(() => paintZoomHudRef.current());
      return next;
    });
  }, [zoomHudKey]);
  const showZoomHudRef = useRef(showZoomHud);
  showZoomHudRef.current = showZoomHud;
  /** Label LOD flags shared between mount and data-patch effects. */
  const graphLodRef = useRef({ edgeLabelsHidden: false, nodeLabelsHidden: false });
  /** Throttled live zoom stats for legend panel (React state, not per-frame). */
  const [zoomHudLive, setZoomHudLive] = useState({ zoom: 1, zone: 'comfortable', nodes: 0, edges: 0 });
  const pushZoomHudLiveRef = useRef(() => {});
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState(null);
  const connectModeRef = useRef(false);
  const connectSourceRef = useRef(null);
  connectModeRef.current = connectMode;
  connectSourceRef.current = connectSource;

  // Path finder mode
  const [pathMode, setPathMode]         = useState(false);
  const [pathSource, setPathSource]     = useState(null);   // first clicked node
  const [pathResult, setPathResult]     = useState(null);   // { paths, found } | null
  const pathModeRef   = useRef(false);
  const pathSourceRef = useRef(null);
  pathModeRef.current   = pathMode;
  pathSourceRef.current = pathSource;

  /** Web gimmick: speculative “theory” edges (2D only). */
  const [theoryMode, setTheoryMode] = useState(false);
  /** Web gimmick: pink “ship” edges between NPC/Character notes (2D only). */
  const [shipMode, setShipMode] = useState(false);
  const theoryModeRef = useRef(false);
  const shipModeRef = useRef(false);
  theoryModeRef.current = theoryMode;
  shipModeRef.current = shipMode;

  /** Highlight-new mode: block note open until all flashing new nodes are acknowledged. */
  const highlightNewModeRef = useRef(false);
  const newHighlightFlashRef = useRef(null);
  /** Node ids the user has acknowledged on the graph (persisted per campaign). */
  const seenGraphNodesRef = useRef(new Set());
  /** Node ids the user has manually dragged — skipped by Organize. */
  const manualGraphNodesRef = useRef(new Set());
  /** Snapshot of positions before an organize preview — restored on cancel. */
  const organizePreviewSnapshotRef = useRef(null);
  /** Mirrors activeEngine === webgl for callbacks defined before renderer selection. */
  const useWebGLRef = useRef(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [layoutHint, setLayoutHint] = useState('');
  const [highlightNewActive, setHighlightNewActive] = useState(false);
  const [newHighlightIds, setNewHighlightIds] = useState(() => new Set());
  const [organizePreview, setOrganizePreview] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);

  const exitPathMode = useCallback(() => {
    setPathMode(false);
    setPathSource(null);
    setPathResult(null);
    pathModeRef.current   = false;
    pathSourceRef.current = null;
    const cy = cyRef.current;
    if (!cy) return;
    clearHighlightClasses(cy, highlightStateRef);
    cy.elements().removeClass('connect-source connect-dim theory-source ship-source');
  }, []);

  // Campaign scoping — playable campaigns only (exclude world-layer roots; matches DB is_world)
  const graphCampaignRoots = useMemo(() => getGraphCampaignRoots(allNotes || []), [allNotes]);
  const campaignKey = `chronicler_graph_campaign_${currentUser?.id || 'anon'}`;
  const is3DKey     = `chronicler_graph_is3d_${currentUser?.id || 'anon'}`;
  const [activeCampaignId, setActiveCampaignIdRaw] = useState(() => {
    try { const s = localStorage.getItem(campaignKey); return s ? parseInt(s) : null; } catch { return null; }
  });
  const setActiveCampaignId = (id) => {
    setActiveCampaignIdRaw(id);
    try { if (id) localStorage.setItem(campaignKey, String(id)); else localStorage.removeItem(campaignKey); } catch {}
  };
  const [is3D, setIs3DRaw] = useState(() => {
    try { return localStorage.getItem(is3DKey) === 'true'; } catch { return false; }
  });
  const effectiveIs3D = tutorialForce3D ? true : (tutorialForce2D ? false : is3D);
  const setIs3D = (val) => {
    const next = typeof val === 'function' ? val(is3D) : val;
    setIs3DRaw(next);
    try { localStorage.setItem(is3DKey, String(next)); } catch {}
  };

  // DM View — show DM-only notes; only available to DMs/admins
  const dmViewKey = `chronicler_graph_dmview_${currentUser?.id || 'anon'}`;
  const isAdminUser = !simulatedRole && !!currentUser?.is_admin;
  const isDMOfActiveCampaign = isAdminUser || (dmCampaignIds || []).includes(activeCampaignId);
  /** Completed campaign/world: no new graph edges or label edits for non-admins. */
  const webReadOnly =
    activeCampaignId != null && isUnderCompletedArchive(allNotes || [], activeCampaignId) && !isAdminUser;

  const safeCreateConnection = useCallback(
    (sourceId, targetId, opts) => {
      if (webReadOnly) return;
      onCreateConnection(sourceId, targetId, opts);
    },
    [webReadOnly, onCreateConnection]
  );

  const [dmView, setDmViewRaw] = useState(() => {
    try { return localStorage.getItem(dmViewKey) === 'true'; } catch { return false; }
  });
  const setDmView = (val) => {
    setDmViewRaw(val);
    try { localStorage.setItem(dmViewKey, String(val)); } catch {}
  };

  // Auto-select first playable campaign; migrate away from stale world-root ids in localStorage
  useEffect(() => {
    if (graphCampaignRoots.length === 0) return;
    const ids = new Set(graphCampaignRoots.map((f) => f.id));
    if (activeCampaignId == null || !ids.has(activeCampaignId)) {
      setActiveCampaignId(graphCampaignRoots[0].id);
    }
  }, [graphCampaignRoots, activeCampaignId]);

  // Filter notes + connections to active campaign subtree (memoized — avoids fingerprint churn)
  const subtreeIds = useMemo(
    () => (activeCampaignId ? getSubtreeIds(allNotes || [], activeCampaignId) : null),
    [allNotes, activeCampaignId]
  );
  const visibleNotes = useMemo(() => {
    const subtreeNotes = subtreeIds ? notes.filter(n => subtreeIds.has(n.id)) : notes;
    return subtreeNotes.filter(n => !n.is_dm_only || (isDMOfActiveCampaign && dmView));
  }, [subtreeIds, notes, isDMOfActiveCampaign, dmView]);
  const visibleConnections = useMemo(() => {
    const visibleNoteIds = new Set(visibleNotes.map(n => n.id));
    const conns = subtreeIds
      ? connections.filter(c => subtreeIds.has(c.source_note_id) && subtreeIds.has(c.target_note_id))
      : connections;
    return conns.filter(c => visibleNoteIds.has(c.source_note_id) && visibleNoteIds.has(c.target_note_id));
  }, [subtreeIds, connections, visibleNotes]);

  const [devFixture, setDevFixture] = useState(null);
  const [devScoreThreshold, setDevScoreThresholdRaw] = useState(() => loadDevScoreThreshold());
  /** Notes/connections fed to cytoscape or WebGL (campaign or dev synthetic fixture). */
  const renderNotes = devFixture?.notes ?? visibleNotes;
  const renderConnections = devFixture?.connections ?? visibleConnections;

  // Edge label + direction editor (graph-only; notes drawer unchanged)
  const [editingEdge, setEditingEdge] = useState(null);
  const editingEdgeRef = useRef(null);
  editingEdgeRef.current = editingEdge;

  /**
   * Persists edge label and direction via API; refreshes connection list on success.
   * @param {number} connId
   * @param {{ label: string, direction: string }} payload
   */
  const handleEdgeSave = useCallback(async (connId, { label, direction }) => {
    if (webReadOnly) return;
    setEditingEdge(null);
    try {
      await api.put(`/connections/${connId}`, { label, direction });
      onUpdateConnection();
    } catch (err) { console.error(err); }
  }, [onUpdateConnection, webReadOnly]);

  /**
   * Deletes a theory or ship edge from the graph (API); closes the editor on success.
   * @param {number} connId
   */
  const handleGimmickEdgeDelete = useCallback(async (connId) => {
    if (webReadOnly || !onDeleteConnection) return;
    try {
      const result = await onDeleteConnection(connId);
      if (result !== false) setEditingEdge(null);
    } catch (err) {
      console.error(err);
    }
  }, [onDeleteConnection, webReadOnly]);

  /** Clears the two-tap link pick state (connect / theory / ship) and node highlight classes. */
  const clearLinkPick = () => {
    setConnectSource(null);
    cyRef.current?.elements().removeClass('connect-source connect-dim theory-source ship-source');
  };

  const exitConnectMode = () => {
    if (connectModeRef.current) clearLinkPick();
    setConnectMode(false);
  };
  const exitTheoryMode = () => {
    if (theoryModeRef.current) clearLinkPick();
    setTheoryMode(false);
  };
  const exitShipMode = () => {
    if (shipModeRef.current) clearLinkPick();
    setShipMode(false);
  };

  /** After a link is created, exit whichever mode was active. */
  const finishActiveLinkMode = () => {
    if (theoryModeRef.current) exitTheoryMode();
    else if (shipModeRef.current) exitShipMode();
    else exitConnectMode();
  };


  useEffect(() => {
    if (!webReadOnly) return;
    exitConnectMode();
    exitTheoryMode();
    exitShipMode();
    exitPathMode();
    setEditingEdge(null);
  }, [webReadOnly, exitPathMode]);

  // Position key for localStorage per campaign
  const posKey = `chronicler_graph_positions_${activeCampaignId || 'all'}`;
  const renderPosKey = devFixture ? BENCH_FIXTURE_POS_KEY : posKey;
  const seenKey = `chronicler_graph_seen_${activeCampaignId || 'all'}`;
  const manualKey = `chronicler_graph_manual_${activeCampaignId || 'all'}`;

  /**
   * Counts nodes on the canvas that the user has not yet acknowledged in highlight mode.
   * @returns {number}
   */
  const refreshUnseenCount = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) {
      const seen = seenGraphNodesRef.current;
      const n = visibleNotes.filter(note => !seen.has(String(note.id))).length;
      setUnseenCount(n);
      return n;
    }
    const seen = seenGraphNodesRef.current;
    const count = cy.nodes().filter(n => !seen.has(n.id())).length;
    setUnseenCount(count);
    return count;
  }, [visibleNotes]);

  useEffect(() => {
    seenGraphNodesRef.current = loadGraphNodeIdSet(seenKey);
    manualGraphNodesRef.current = loadGraphNodeIdSet(manualKey);
    refreshUnseenCount();
    highlightNewModeRef.current = false;
    setHighlightNewActive(false);
    stopNewHighlightFlash(newHighlightFlashRef, cyRef.current);
    organizePreviewSnapshotRef.current = null;
    setOrganizePreview(false);
    setLayoutHint('');
  }, [seenKey, manualKey, refreshUnseenCount]);

  /**
   * Leaves highlight-new mode and clears gold rings from the canvas.
   */
  const exitHighlightNewMode = useCallback(() => {
    highlightNewModeRef.current = false;
    setHighlightNewActive(false);
    setNewHighlightIds(new Set());
    stopNewHighlightFlash(newHighlightFlashRef, cyRef.current);
    cyRef.current?.nodes().removeClass('new-highlight new-highlight-flash');
    sigmaRendererRef.current?.clearNewHighlights();
    setLayoutHint('');
  }, []);

  /**
   * Marks one new node as seen and exits highlight mode when none remain.
   * @param {string} nodeId
   */
  const acknowledgeNewNode = useCallback((nodeId) => {
    if (!highlightNewModeRef.current) return;
    const id = String(nodeId);
    seenGraphNodesRef.current.add(id);
    saveGraphNodeIdSet(seenKey, seenGraphNodesRef.current);
    cyRef.current?.getElementById(id).removeClass('new-highlight new-highlight-flash');
    setNewHighlightIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      const remaining = next.size;
      refreshUnseenCount();
      if (remaining === 0) {
        exitHighlightNewMode();
        setLayoutHint('All new nodes acknowledged');
        setTimeout(() => setLayoutHint(''), 2800);
      } else {
        setLayoutHint(`${remaining} new node${remaining > 1 ? 's' : ''} remaining — click each ring`);
      }
      return next;
    });
  }, [seenKey, exitHighlightNewMode, refreshUnseenCount]);

  /**
   * Enters highlight-new mode: gold flashing rings on unseen nodes; blocks note open until done.
   */
  const enterHighlightNewMode = useCallback(() => {
    if (effectiveIs3D) return;
    exitConnectMode();
    exitTheoryMode();
    exitShipMode();
    exitPathMode();
    setEditingEdge(null);
    const unseenIds = renderNotes
      .filter((n) => !seenGraphNodesRef.current.has(String(n.id)))
      .map((n) => String(n.id));
    if (unseenIds.length === 0) {
      setLayoutHint('No new nodes on the map');
      setTimeout(() => setLayoutHint(''), 2800);
      return;
    }
    highlightNewModeRef.current = true;
    setHighlightNewActive(true);
    setNewHighlightIds(new Set(unseenIds));
    const cy = cyRef.current;
    if (cy) {
      cy.batch(() => {
        cy.nodes().removeClass('new-highlight new-highlight-flash');
        unseenIds.forEach((nid) => cy.getElementById(nid).addClass('new-highlight'));
      });
      startNewHighlightFlash(cy, newHighlightFlashRef);
    }
    setLayoutHint(`${unseenIds.length} new node${unseenIds.length > 1 ? 's' : ''} — click each golden ring`);
  }, [effectiveIs3D, exitPathMode, renderNotes]);

  /**
   * Restores the pre-preview node positions and unlocks all nodes.
   */
  const cancelOrganizePreview = useCallback(() => {
    if (useWebGLRef.current) {
      sigmaRendererRef.current?.cancelOrganizePreview();
      organizePreviewSnapshotRef.current = null;
      setOrganizePreview(false);
      setLayoutHint('');
      return;
    }
    const cy = cyRef.current;
    const snapshot = organizePreviewSnapshotRef.current;
    if (!cy || !snapshot) {
      setOrganizePreview(false);
      return;
    }
    cy.nodes().unlock();
    cy.batch(() => {
      cy.nodes().forEach(n => {
        const p = snapshot[n.id()];
        if (p) n.position(p);
      });
    });
    organizePreviewSnapshotRef.current = null;
    setOrganizePreview(false);
    setLayoutHint('');
  }, []);

  /**
   * Commits the organize preview layout to localStorage and unlocks nodes.
   */
  const confirmOrganizePreview = useCallback(() => {
    if (useWebGLRef.current) {
      const renderer = sigmaRendererRef.current;
      if (!renderer) return;
      const pos = renderer.getPositions();
      try { localStorage.setItem(renderPosKey, JSON.stringify(pos)); } catch (e) {}
      renderer.confirmOrganizePreview();
      organizePreviewSnapshotRef.current = null;
      setOrganizePreview(false);
      setLayoutHint('Layout applied');
      setTimeout(() => setLayoutHint(''), 2800);
      return;
    }
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unlock();
    const pos = {};
    cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
    try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch (e) {}
    organizePreviewSnapshotRef.current = null;
    setOrganizePreview(false);
    setLayoutHint('Layout applied');
    setTimeout(() => setLayoutHint(''), 2800);
  }, [posKey, renderPosKey]);

  /**
   * Runs organize layout on the WebGL renderer when organize preview is toggled on.
   * @param {import('../graph/renderers/SigmaRenderer.js').SigmaRenderer} renderer
   */
  const handleWebGLOrganize = useCallback((renderer) => {
    const manual = manualGraphNodesRef.current;
    const movable = renderNotes.filter((n) => !manual.has(String(n.id))).length;
    if (movable === 0) {
      setOrganizePreview(false);
      setLayoutHint('Every node has been moved by hand — nothing to organize');
      setTimeout(() => setLayoutHint(''), 3200);
      return;
    }
    renderer.runOrganizePreview(manual);
    setLayoutHint(`Organizing ${movable} node${movable > 1 ? 's' : ''} — confirm or cancel below`);
  }, [renderNotes]);

  /**
   * Persists manual node flag and position after a WebGL drag ends.
   * @param {string} nodeId
   */
  const handleWebGLDragEnd = useCallback((nodeId) => {
    manualGraphNodesRef.current.add(String(nodeId));
    saveGraphNodeIdSet(manualKey, manualGraphNodesRef.current);
    const renderer = sigmaRendererRef.current;
    if (renderer) {
      renderer.setVisualState({ manualNodeIds: manualGraphNodesRef.current });
      try { localStorage.setItem(renderPosKey, JSON.stringify(renderer.getPositions())); } catch (e) {}
    }
  }, [manualKey, renderPosKey]);

  /**
   * Opens the edge label editor from a WebGL edge tap.
   * @param {{ connId: number, label: string, direction: string, kind: string, screenX: number, screenY: number }} payload
   */
  const handleWebGLEdgeClick = useCallback((payload) => {
    if (connectModeRef.current || theoryModeRef.current || shipModeRef.current || pathModeRef.current) return;
    const gimmickKind = payload.kind === 'theory' || payload.kind === 'ship' ? payload.kind : null;
    setEditingEdge({
      connId: payload.connId,
      label: payload.label,
      direction: payload.direction || 'bidirectional',
      gimmickKind,
      x: payload.screenX,
      y: payload.screenY,
    });
  }, []);

  /**
   * Runs a force layout on nodes the user has not manually placed; shows confirm/cancel preview.
   */
  const runOrganizePreview = useCallback(() => {
    if (useWebGLRef.current) {
      if (effectiveIs3D || organizePreview) return;
      exitHighlightNewMode();
      exitConnectMode();
      exitTheoryMode();
      exitShipMode();
      exitPathMode();
      setEditingEdge(null);
      const manual = manualGraphNodesRef.current;
      const movable = renderNotes.filter((n) => !manual.has(String(n.id))).length;
      if (movable === 0) {
        setLayoutHint('Every node has been moved by hand — nothing to organize');
        setTimeout(() => setLayoutHint(''), 3200);
        return;
      }
      setOrganizePreview(true);
      return;
    }
    const cy = cyRef.current;
    if (!cy || effectiveIs3D || organizePreview) return;
    exitHighlightNewMode();
    exitConnectMode();
    exitTheoryMode();
    exitShipMode();
    exitPathMode();
    setEditingEdge(null);
    const manual = manualGraphNodesRef.current;
    const movable = cy.nodes().filter(n => !manual.has(n.id()));
    if (movable.length === 0) {
      setLayoutHint('Every node has been moved by hand — nothing to organize');
      setTimeout(() => setLayoutHint(''), 3200);
      return;
    }
    const snapshot = {};
    cy.nodes().forEach(n => { snapshot[n.id()] = { ...n.position() }; });
    organizePreviewSnapshotRef.current = snapshot;
    setOrganizePreview(true);
    setLayoutHint(`Organizing ${movable.length} node${movable.length > 1 ? 's' : ''} — confirm or cancel below`);
    cy.nodes().forEach(n => {
      if (manual.has(n.id())) n.lock();
      else n.unlock();
    });
    const layout = cy.layout({
      name: 'cose',
      animate: true,
      animationDuration: 900,
      fit: false,
      randomize: false,
      nodeRepulsion: () => 140000,
      idealEdgeLength: () => 190,
      edgeElasticity: () => 120,
      nodeOverlap: 24,
      gravity: 0.12,
      numIter: 2500,
      padding: 70,
    });
    layout.one('layoutstop', () => separateLabels(cy, null));
    layout.run();
  }, [effectiveIs3D, organizePreview, exitHighlightNewMode, exitPathMode, posKey]);

  /** Updated every render so Cytoscape listeners always call latest handlers (no rebind). */
  graphHandlersRef.current = {
    onSelectNote,
    onOpenNote,
    onCreateConnection: safeCreateConnection,
    setConnectSource,
    finishActiveLinkMode,
    setEditingEdge,
    setPathSource,
    setPathResult,
    exitPathMode,
    acknowledgeNewNode,
  };

  const placeNewGraphNodes = useCallback((cy, addedNodeIds, savedPositions, posKey) => {
    if (addedNodeIds.length === 0) return;
    addedNodeIds.forEach((nid, idx) => {
      if (savedPositions?.[nid]) return;
      const node = cy.getElementById(nid);
      if (!node.length) return;
      const neighbours = node.neighborhood('node');
      let cx = 0, cy_ = 0, count = 0;
      neighbours.forEach(nb => {
        if (!addedNodeIds.includes(nb.id())) {
          const p = nb.position();
          cx += p.x; cy_ += p.y; count++;
        }
      });
      if (count > 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 180 + Math.random() * 80;
        node.position({ x: cx / count + Math.cos(angle) * dist, y: cy_ / count + Math.sin(angle) * dist });
      } else {
        const ext = cy.nodes().not(node).boundingBox();
        const ox = (ext.x1 + ext.x2) / 2 || 0;
        const oy = (ext.y1 + ext.y2) / 2 || 0;
        const angle = (idx * 2.4) + Math.random() * 0.4;
        const dist = 220 + idx * 90;
        node.position({ x: ox + Math.cos(angle) * dist, y: oy + Math.sin(angle) * dist });
      }
    });
    const pos = {};
    cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
    try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch (e) {}
  }, []);

  const rendererPrefKey = `chronicler_graph_renderer_${currentUser?.id || 'anon'}`;
  const [rendererPref, setRendererPrefRaw] = useState(() => loadRendererPref(rendererPrefKey));
  const lockedRendererRef = useRef(null);

  useEffect(() => {
    lockedRendererRef.current = null;
  }, [activeCampaignId, rendererPref]);

  const activeEngine = useMemo(() => {
    const threshold = effectiveGraphScoreThreshold(devScoreThreshold);
    const score = graphSizeScore(renderNotes.length, renderConnections.length);
    const picked = selectGraphRenderer({
      nodeCount: renderNotes.length,
      edgeCount: renderConnections.length,
      userPref: rendererPref,
      deviceMemoryGb: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
      isMobile,
      scoreThreshold: threshold,
    });
    if (rendererPref !== 'auto') {
      lockedRendererRef.current = picked;
      return picked;
    }
    const resolved = resolveAutoRenderer(picked, lockedRendererRef.current, score, threshold);
    lockedRendererRef.current = resolved;
    return resolved;
  }, [renderNotes.length, renderConnections.length, rendererPref, isMobile, activeCampaignId, devScoreThreshold, devFixture]);

  const useWebGL = activeEngine === 'webgl' && !effectiveIs3D;
  useWebGLRef.current = useWebGL;

  const graphRenderScore = graphSizeScore(renderNotes.length, renderConnections.length);

  /**
   * Loads a synthetic benchmark graph into the live renderer (dev port 3002 only).
   * @param {number} nodeCount
   */
  const loadDevFixture = useCallback((nodeCount) => {
    const { notes, connections, positions } = generateBenchmarkGraph(nodeCount);
    try { localStorage.setItem(BENCH_FIXTURE_POS_KEY, JSON.stringify(positions)); } catch (e) {}
    setDevFixture({ notes, connections });
    lockedRendererRef.current = null;
  }, []);

  /** Restores the campaign graph after a dev synthetic fixture. */
  const clearDevFixture = useCallback(() => {
    setDevFixture(null);
    lockedRendererRef.current = null;
  }, []);

  /**
   * Updates dev-only auto-WebGL score threshold (null = production default).
   * @param {number|null} threshold
   */
  const applyDevScoreThreshold = useCallback((threshold) => {
    saveDevScoreThreshold(threshold);
    setDevScoreThresholdRaw(threshold);
    lockedRendererRef.current = null;
  }, []);

  const setRendererPref = useCallback((val) => {
    setRendererPrefRaw((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      saveRendererPref(rendererPrefKey, next);
      lockedRendererRef.current = null;
      return next;
    });
  }, [rendererPrefKey]);

  /**
   * Blocks Cytoscape-only toolbar actions when the performance (WebGL) map is active.
   * @param {() => void} action
   */
  const guardStandardMapOnly = useCallback((action) => {
    action();
  }, []);

  // Initial mount — Cytoscape only when standard engine is active
  useEffect(() => {
    if (!containerRef.current || useWebGL) return;

    const elements = buildElements(renderNotes, renderConnections);
    const nodeElements = elements.filter(e => !e.data.source);
    let savedPositions = null;
    try { savedPositions = JSON.parse(localStorage.getItem(renderPosKey)); } catch (e) {}
    const hasAnySaved = savedPositions && nodeElements.some(e => savedPositions[e.data.id]);
    const allSaved = savedPositions && nodeElements.every(e => savedPositions[e.data.id]);
    const runFullLayout = !hasAnySaved;

    const basePixelRatio = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      GRAPH_PIXEL_RATIO_CAP
    );
    let styleTransitionsOn = true;

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      style: getCachedStyle(theme),
      layout: runFullLayout
        ? { name: 'cose', animate: true, animationDuration: 900, nodeRepulsion: () => 80000, idealEdgeLength: () => 200, nodeOverlap: 40, gravity: 0.25, numIter: 2000, padding: 80 }
        : { name: 'preset', positions: (node) => savedPositions[node.id()], padding: 80 },
      wheelSensitivity: 0,
      boxSelectionEnabled: false,
      zoomingEnabled: true,
      panningEnabled: true,
      minZoom: GRAPH_MIN_ZOOM,
      maxZoom: GRAPH_MAX_ZOOM,
      pixelRatio: basePixelRatio,
    });

    const cy = cyRef.current;
    const lodState = graphLodRef.current;
    let gestureEndTimer = null;
    let hudPaintTimer = null;

    if (!localStorage.getItem(seenKey)) {
      const initial = [];
      cy.nodes().forEach(n => initial.push(n.id()));
      seenGraphNodesRef.current = new Set(initial);
      saveGraphNodeIdSet(seenKey, seenGraphNodesRef.current);
    } else {
      seenGraphNodesRef.current = loadGraphNodeIdSet(seenKey);
    }
    manualGraphNodesRef.current = loadGraphNodeIdSet(manualKey);
    refreshUnseenCount();

    const cancelHoverPreview = () => {
      clearTimeout(hoverTimerRef.current);
      clearHighlightClasses(cy, highlightStateRef);
    };
    const beginViewportGesture = () => {
      suppressHoverRef.current = true;
      cancelHoverPreview();
      if (styleTransitionsOn) {
        styleTransitionsOn = false;
        setGraphStyleTransitions(cy, false);
      }
    };
    const endViewportGesture = () => {
      suppressHoverRef.current = false;
      if (!styleTransitionsOn) {
        styleTransitionsOn = true;
        setGraphStyleTransitions(cy, true);
      }
    };
    const scheduleViewportSettle = () => {
      clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(() => {
        endViewportGesture();
        updateGraphLod(cy, lodState);
        paintZoomHudRef.current();
        pushZoomHudLiveRef.current();
      }, 200);
    };

    // Restore saved positions and place only nodes that lack coordinates — never re-run cose for the whole graph.
    if (hasAnySaved && !allSaved) {
      const unsavedIds = [];
      cy.nodes().forEach(n => {
        const saved = savedPositions[n.id()];
        if (saved) n.position(saved);
        else unsavedIds.push(n.id());
      });
      placeNewGraphNodes(cy, unsavedIds, savedPositions, renderPosKey);
    }

    // Smooth wheel zoom — same rates as pre–perf-work (v1.5.0).
    let zoomTarget = cy.zoom();
    let zoomRAF = null;
    let lastWheelPos = null;
    const smoothZoom = (e) => {
      e.preventDefault();
      beginViewportGesture();
      const delta = e.deltaY > 0 ? 0.92 : 1.09;
      zoomTarget = Math.min(Math.max(zoomTarget * delta, GRAPH_MIN_ZOOM), GRAPH_MAX_ZOOM);
      const containerRect = containerRef.current.getBoundingClientRect();
      lastWheelPos = {
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      };
      if (zoomRAF) return;
      const tick = () => {
        const cur = cy.zoom();
        const diff = zoomTarget - cur;
        if (Math.abs(diff) < 0.0008) {
          cy.zoom({ level: zoomTarget, renderedPosition: lastWheelPos });
          zoomRAF = null;
          scheduleViewportSettle();
          return;
        }
        cy.zoom({ level: cur + diff * 0.18, renderedPosition: lastWheelPos });
        zoomRAF = requestAnimationFrame(tick);
      };
      zoomRAF = requestAnimationFrame(tick);
    };
    containerRef.current.addEventListener('wheel', smoothZoom, { passive: false });
    // Keep wheel target in sync after programmatic zoom (selection center) — not during wheel lerp.
    cy.on('zoom', () => {
      if (!zoomRAF) zoomTarget = cy.zoom();
    });
    const savePositions = () => {
      const pos = {};
      cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
      try { localStorage.setItem(renderPosKey, JSON.stringify(pos)); } catch (e) {}
    };
    cy.on('dragfree', 'node', (e) => {
      manualGraphNodesRef.current.add(e.target.id());
      saveGraphNodeIdSet(manualKey, manualGraphNodesRef.current);
      savePositions();
    });
    cy.on('layoutstop', savePositions);
    // On first load with no saved positions, de-overlap labels after layout settles
    if (runFullLayout) {
      cy.one('layoutstop', () => separateLabels(cy, renderPosKey));
    }

    dataFingerprintRef.current = buildGraphFingerprint(renderNotes, renderConnections);
    canonAdjRef.current = buildCanonAdjacency(renderConnections);

    let renderFrames = 0;
    let fpsInterval = null;
    paintZoomHudRef.current = () => {
      if (!showZoomHudRef.current) return;
      paintZoomHud(zoomHudRef.current, cy);
    };
    pushZoomHudLiveRef.current = () => {
      setZoomHudLive({
        zoom: cy.zoom(),
        zone: zoomPerformanceZone(cy.zoom()),
        nodes: cy.nodes().length,
        edges: cy.edges().length,
      });
    };
    const onRender = () => { renderFrames += 1; };
    cy.on('render', onRender);
    fpsInterval = setInterval(() => {
      if (!showZoomHudRef.current) return;
      const fpsEl = zoomHudRef.current?.querySelector('[data-fps]');
      if (fpsEl) fpsEl.textContent = `${renderFrames} FPS`;
      renderFrames = 0;
    }, 1000);
    const onViewportChange = () => {
      scheduleViewportSettle();
      clearTimeout(hudPaintTimer);
      hudPaintTimer = setTimeout(() => paintZoomHudRef.current(), 120);
    };
    cy.on('zoom pan', onViewportChange);
    updateGraphLod(cy, lodState);
    paintZoomHudRef.current();
    pushZoomHudLiveRef.current();

    bindEvents(cy, graphHandlersRef, hoverTimerRef, suppressHoverRef, connectModeRef, connectSourceRef, editingEdgeRef, pathModeRef, pathSourceRef, theoryModeRef, shipModeRef, canonAdjRef, highlightStateRef, highlightNewModeRef);

    cy.on('panstart', beginViewportGesture);
    cy.on('mousedown', (e) => {
      if (e.target === cy) beginViewportGesture();
    });
    cy.on('grab', 'node', beginViewportGesture);
    cy.on('panend', scheduleViewportSettle);
    cy.on('mouseup', scheduleViewportSettle);
    cy.on('free', 'node', scheduleViewportSettle);

    cy.ready(() => {
      if (cy.zoom() > GRAPH_MAX_ZOOM) cy.zoom(GRAPH_MAX_ZOOM);
      cy.forceRender();
    });

    return () => {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(gestureEndTimer);
      clearTimeout(hudPaintTimer);
      stopNewHighlightFlash(newHighlightFlashRef, cy);
      if (fpsInterval) clearInterval(fpsInterval);
      cy.off('render', onRender);
      if (zoomRAF) cancelAnimationFrame(zoomRAF);
      paintZoomHudRef.current = () => {};
      pushZoomHudLiveRef.current = () => {};
      containerRef.current?.removeEventListener('wheel', smoothZoom);
      cy.destroy();
      cyRef.current = null;
      isFirstMount.current = true;
      highlightStateRef.current.touched = null;
      suppressHoverRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId, useWebGL]);

  // Update graph when notes/connections change after mount
  useEffect(() => {
    if (useWebGL) return;
    const cy = cyRef.current;
    if (!cy) return;
    if (isFirstMount.current) { isFirstMount.current = false; return; }

    const fp = buildGraphFingerprint(renderNotes, renderConnections);
    if (fp === dataFingerprintRef.current) return;
    dataFingerprintRef.current = fp;
    canonAdjRef.current = buildCanonAdjacency(renderConnections);

    const newElements = buildElements(renderNotes, renderConnections);
    const newIds = new Set(newElements.map(e => e.data.id));

    let savedPositions = null;
    try { savedPositions = JSON.parse(localStorage.getItem(renderPosKey)); } catch (e) {}
    const addedNodeIds = [];

    cy.batch(() => {
      cy.elements().forEach(el => { if (!newIds.has(el.id())) el.remove(); });
      newElements.forEach(el => {
        if (!cy.getElementById(el.data.id).length) {
          cy.add(el);
          if (!el.data.source) addedNodeIds.push(el.data.id);
        } else {
          const existing = cy.getElementById(el.data.id);
          if (el.data.label !== undefined) existing.data('label', el.data.label);
          if (el.data.source) {
            if (el.data.direction !== undefined) existing.data('direction', el.data.direction);
            if (el.classes) existing.classes(el.classes);
          }
        }
      });
    });

    placeNewGraphNodes(cy, addedNodeIds, savedPositions, renderPosKey);
    updateGraphLod(cy, graphLodRef.current);
    paintZoomHudRef.current();
    refreshUnseenCount();
  }, [renderNotes, renderConnections, placeNewGraphNodes, renderPosKey, refreshUnseenCount, useWebGL]);

  // Re-apply graph stylesheet when theme tokens change (edge colors, label text, canvas bg)
  useEffect(() => {
    if (useWebGL) return;
    applyGraphStyle(cyRef.current, theme);
  }, [theme, useWebGL]);

  // Tiered highlight for selected note — uses precomputed adjacency, batched class updates
  useEffect(() => {
    if (useWebGL) return;
    const cy = cyRef.current;
    if (!cy) return;
    if (!selectedNoteId) {
      clearHighlightClasses(cy, highlightStateRef);
      lastCenteredRef.current = null;
      return;
    }
    const tiers = getTiersFromAdj(canonAdjRef.current, selectedNoteId, 3);
    applyTierHighlight(cy, tiers, 3, highlightStateRef);
    if (selectedNoteId !== lastCenteredRef.current) {
      lastCenteredRef.current = selectedNoteId;
      const sel = cy.$(`#${selectedNoteId}`);
      if (sel.length) cy.animate({ center: { eles: sel }, zoom: 1.4 }, { duration: 350 });
    }
  }, [selectedNoteId, useWebGL]);

  /** Paint HUD once the overlay mounts after toggling on. */
  useEffect(() => {
    if (!showZoomHud || effectiveIs3D) return;
    requestAnimationFrame(() => paintZoomHudRef.current());
  }, [showZoomHud, effectiveIs3D, useWebGL]);

  const activeCampaignName = graphCampaignRoots.find((f) => f.id === activeCampaignId)?.title;

  const rootRef = useRef(null);
  const containerWidth = useContainerWidth(rootRef);
  const campaignRef = useRef(null);
  const toolbarRef = useRef(null);
  const [isNarrowGraph, setIsNarrowGraph] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [sigmaBench, setSigmaBench] = useState(() => isSigmaBenchEnabled());
  const [showDevPanel, setShowDevPanel] = useState(true);

  const enginePrefLabel = rendererPref === 'auto'
    ? `Auto (${activeEngine})`
    : rendererPref === 'webgl' ? 'Performance' : 'Standard';

  const cycleEnginePref = useCallback(() => {
    setRendererPref((prev) => {
      if (prev === 'auto') return 'cytoscape';
      if (prev === 'cytoscape') return 'webgl';
      return 'auto';
    });
  }, [setRendererPref]);

  /**
   * Mobile UX: force the graph action bar into an overflow menu.
   * On vertical mobile screens, the action set is too wide to fit without overflow.
   */
  const shouldCollapseToolbar = isMobile || isNarrowGraph;

  /** Shared styles for Layout dropdown menu items (Highlight New / Organize). */
  const layoutMenuItemStyle = (opts = {}) => ({
    fontFamily: 'var(--ch-font-display)',
    fontSize: '9px',
    letterSpacing: '0.1em',
    padding: isMobile ? '11px 10px' : '7px 10px',
    minHeight: isMobile ? '44px' : 'auto',
    borderRadius: '3px',
    cursor: opts.disabled ? 'default' : 'pointer',
    textAlign: 'left',
    background: 'transparent',
    border: '1px solid var(--ch-border)',
    color: 'rgba(200,148,58,0.7)',
    opacity: opts.disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
  });

  /**
   * Renders Layout submenu entries used in both the overflow and inline toolbars.
   * @param {() => void} closeMenu
   * @param {{ layoutTutorialRef?: import('react').RefObject<HTMLElement|null>|null }} [opts]
   */
  const renderLayoutMenuItems = (closeMenu, opts = {}) => (
    <>
      <button
        type="button"
        onClick={() => { cycleEnginePref(); closeMenu(); }}
        style={layoutMenuItemStyle()}
      >
        Map engine: {enginePrefLabel}
      </button>
      <button
        ref={opts.layoutTutorialRef || null}
        type="button"
        onClick={() => { enterHighlightNewMode(); closeMenu(); }}
        style={layoutMenuItemStyle()}
      >
        ◎ Highlight New{unseenCount > 0 ? ` (${unseenCount})` : ''}
      </button>
      <button
        type="button"
        onClick={() => { runOrganizePreview(); closeMenu(); }}
        disabled={organizePreview}
        style={layoutMenuItemStyle({ disabled: organizePreview })}
      >
        ⊞ Organize
      </button>
      {devGraphToolsEnabled && (
        <>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.16em', color: 'rgba(58,196,120,0.55)', padding: '6px 4px 2px', borderTop: '1px solid rgba(58,196,120,0.2)', marginTop: 4 }}>
            DEV TESTS
          </div>
          <button type="button" onClick={() => { loadDevFixture(500); closeMenu(); }} style={layoutMenuItemStyle()}>
            ⊕ Load 500 nodes
          </button>
          <button type="button" onClick={() => { loadDevFixture(100); closeMenu(); }} style={layoutMenuItemStyle()}>
            ⊕ Load 100 nodes
          </button>
          {devFixture && (
            <button type="button" onClick={() => { clearDevFixture(); closeMenu(); }} style={layoutMenuItemStyle()}>
              ↩ Clear fixture
            </button>
          )}
          <button type="button" onClick={() => { applyDevScoreThreshold(40); closeMenu(); }} style={layoutMenuItemStyle()}>
            Auto threshold: Demo (40)
          </button>
          <button type="button" onClick={() => { applyDevScoreThreshold(null); closeMenu(); }} style={layoutMenuItemStyle()}>
            Auto threshold: Prod ({LARGE_GRAPH_SCORE_THRESHOLD})
          </button>
          <button
            type="button"
            onClick={() => {
              try { localStorage.setItem('chronicler_dev_sigma_bench', '1'); } catch (e) {}
              setSigmaBench(true);
              closeMenu();
            }}
            style={layoutMenuItemStyle()}
          >
            ◈ Sigma bench
          </button>
          <button type="button" onClick={() => { setShowDevPanel((v) => !v); closeMenu(); }} style={layoutMenuItemStyle()}>
            {showDevPanel ? '▾ Hide dev panel' : '▸ Show dev panel'}
          </button>
        </>
      )}
    </>
  );

  // Collapse toolbar to dropdown if it would overlap the campaign selector
  useEffect(() => {
    const campaign = campaignRef.current;
    const toolbar = toolbarRef.current;
    if (!campaign || !toolbar) return;
    const campaignRight = campaign.getBoundingClientRect().right;
    const toolbarLeft = toolbar.getBoundingClientRect().left;
    setIsNarrowGraph(toolbarLeft - 16 < campaignRight);
  }, [containerWidth, activeCampaignId, isDMOfActiveCampaign, is3D]);

  /** Tutorial: keep the ··· overflow menu open when toolbar buttons are collapsed (e.g. large text scale). */
  useEffect(() => {
    if (tutorialForceToolMenu) setShowToolMenu(true);
  }, [tutorialForceToolMenu]);

  if (sigmaBench) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ch-shell-bg)' }}>
        <GraphSigmaBench onExit={() => {
          try { localStorage.removeItem('chronicler_dev_sigma_bench'); } catch (e) {}
          setSigmaBench(false);
        }} />
      </div>
    );
  }

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (tutorialRefs?.canvas) tutorialRefs.canvas.current = el;
      }}
      style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ch-shell-bg)' }}
    >
      {/* Grid background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.012) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.012) 40px)`,
      }} />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 1, display: (effectiveIs3D || useWebGL) ? 'none' : 'block' }} />

      {useWebGL && (
        <Suspense fallback={(
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(200,148,58,0.6)', fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.12em',
          }}
          >
            Loading performance map…
          </div>
        )}
        >
          <GraphView2DWebGL
            notes={renderNotes}
            connections={renderConnections}
            posKey={renderPosKey}
            theme={theme}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onOpenNote={onOpenNote}
            onCreateConnection={safeCreateConnection}
            onEdgeClick={handleWebGLEdgeClick}
            onAcknowledgeNewNode={acknowledgeNewNode}
            onDragEnd={handleWebGLDragEnd}
            connectMode={connectMode}
            theoryMode={theoryMode}
            shipMode={shipMode}
            pathMode={pathMode}
            connectSource={connectSource}
            pathSource={pathSource}
            pathResult={pathResult}
            onConnectSourceSet={setConnectSource}
            onPathSourceSet={setPathSource}
            onPathResult={setPathResult}
            highlightNewActive={highlightNewActive}
            newHighlightIds={newHighlightIds}
            manualNodeIds={manualGraphNodesRef.current}
            organizePreview={organizePreview}
            onRunOrganize={handleWebGLOrganize}
            zoomHudRef={zoomHudRef}
            showZoomHudRef={showZoomHudRef}
            paintZoomHudRef={paintZoomHudRef}
            pushZoomHudLiveRef={pushZoomHudLiveRef}
            rendererRef={sigmaRendererRef}
          />
        </Suspense>
      )}

      {/* Zoom / FPS HUD — bottom-right so the left legend does not cover it */}
      {showZoomHud && !effectiveIs3D && (
        <div
          ref={zoomHudRef}
          style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            zIndex: 20,
            pointerEvents: 'none',
            fontFamily: 'Cinzel, serif',
            fontSize: '10px',
            letterSpacing: '0.08em',
            color: 'var(--ch-text-primary-90)',
            background: 'rgba(7,8,14,0.92)',
            border: '1px solid rgba(200,148,58,0.35)',
            borderRadius: '4px',
            padding: '9px 12px',
            lineHeight: 1.55,
            minWidth: '172px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ fontSize: '8px', letterSpacing: '0.18em', color: 'rgba(200,148,58,0.65)', marginBottom: '4px' }}>ZOOM SCALE</div>
          <div data-zoom style={{ color: 'var(--ch-accent)', fontSize: '13px' }}>—</div>
          <div data-zone style={{ fontSize: '9px', color: 'var(--ch-text-primary-55)', marginTop: '2px' }}>—</div>
          <div data-visible style={{ fontSize: '9px', color: 'var(--ch-text-primary-45)', marginTop: '2px' }}>—</div>
          <div data-stats style={{ fontSize: '9px', color: 'var(--ch-text-primary-50)', marginTop: '4px' }}>—</div>
          <div data-fps style={{ fontSize: '9px', color: 'rgba(139,196,226,0.75)', marginTop: '2px' }}>— FPS</div>
          <div data-engine style={{ fontSize: '8px', color: 'var(--ch-text-primary-45)', marginTop: '4px' }}>—</div>
          <div style={{ fontSize: '8px', color: 'var(--ch-text-primary-35)', marginTop: '6px', letterSpacing: '0.04em' }}>
            Range {GRAPH_MIN_ZOOM.toFixed(2)}–{GRAPH_MAX_ZOOM.toFixed(2)} · drag pan · wheel zoom
          </div>
        </div>
      )}

      {/* Edge editor — label + direction (graph only) */}
      {editingEdge && (
        <div style={{
          position: 'absolute', zIndex: 10,
          left: Math.max(8, editingEdge.x - 160), top: editingEdge.y - 8,
          background: 'var(--ch-card-bg)', border: '1px solid rgba(200,148,58,0.35)',
          borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.8)', maxWidth: 'min(92vw, 360px)',
        }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              autoFocus
              disabled={webReadOnly}
              style={{
                flex: '1 1 140px', minWidth: '120px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ch-border-strong)',
                borderRadius: '3px', color: 'var(--ch-text-primary)', fontFamily: 'var(--ch-font-body)', fontSize: '14px',
                padding: '4px 8px', outline: 'none',
              }}
              value={editingEdge.label}
              onChange={e => setEditingEdge(prev => ({ ...prev, label: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') handleEdgeSave(editingEdge.id, { label: editingEdge.label, direction: editingEdge.direction });
                if (e.key === 'Escape') setEditingEdge(null);
              }}
              placeholder="Connection label (optional)..."
            />
            <button
              disabled={webReadOnly}
              onClick={() => handleEdgeSave(editingEdge.id, { label: editingEdge.label, direction: editingEdge.direction })}
              style={{ padding: '4px 8px', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', cursor: webReadOnly ? 'default' : 'pointer', color: 'var(--ch-accent)', fontFamily: 'var(--ch-font-display)', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1 }}
            >
              SAVE
            </button>
            <button
              disabled={webReadOnly}
              onClick={() => handleEdgeSave(editingEdge.id, { label: '', direction: editingEdge.direction })}
              style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', cursor: webReadOnly ? 'default' : 'pointer', color: 'var(--ch-text-primary-40)', fontFamily: 'var(--ch-font-display)', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1 }}
            >
              CLEAR
            </button>
            {editingEdge.gimmickKind && onDeleteConnection && (
              <button
                type="button"
                disabled={webReadOnly}
                onClick={() => handleGimmickEdgeDelete(editingEdge.id)}
                title="Remove this theory or ship link"
                style={{
                  padding: '4px 8px', background: 'rgba(196,80,80,0.12)', border: '1px solid rgba(196,100,100,0.35)', borderRadius: '3px',
                  cursor: webReadOnly ? 'default' : 'pointer', color: 'rgba(240,160,160,0.95)', fontFamily: 'var(--ch-font-display)', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1,
                }}
              >
                REMOVE
              </button>
            )}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.55)', marginBottom: '5px' }}>
              DIRECTION
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { value: 'bidirectional', label: '↔ Both ways' },
                { value: 'forward', label: `→ ${truncateGraphTitle(editingEdge.sourceTitle)} → ${truncateGraphTitle(editingEdge.targetTitle)}` },
                { value: 'reverse', label: `→ ${truncateGraphTitle(editingEdge.targetTitle)} → ${truncateGraphTitle(editingEdge.sourceTitle)}` },
              ].map(({ value, label }) => {
                const active = editingEdge.direction === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={webReadOnly}
                    onClick={() => setEditingEdge(prev => ({ ...prev, direction: value }))}
                    style={{
                      textAlign: 'left', padding: '6px 8px', borderRadius: '3px', cursor: webReadOnly ? 'default' : 'pointer',
                      fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.06em',
                      background: active ? 'var(--ch-accent-18)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(200,148,58,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      color: active ? '#c8943a' : 'var(--ch-text-primary-65)',
                      opacity: webReadOnly ? 0.5 : 1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Campaign selector + completed banner — column so the banner is never behind the dropdown */}
      {graphCampaignRoots.length > 0 && (
        <div
          ref={campaignRef}
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            maxWidth: 'min(96vw, 520px)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto' }}>
            {graphCampaignRoots.length === 1 ? (
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)', whiteSpace: 'nowrap' }}>
                {activeCampaignName?.toUpperCase()}
              </div>
            ) : (
              <select
                ref={tutorialRefs?.campaignSelect || null}
                value={activeCampaignId || ''}
                onChange={e => setActiveCampaignId(parseInt(e.target.value))}
                style={{
                  background: 'rgba(7,8,14,0.9)', border: '1px solid rgba(200,148,58,0.3)',
                  borderRadius: '3px', color: 'var(--ch-accent)', fontFamily: 'var(--ch-font-display)', fontSize: '10px',
                  letterSpacing: '0.1em', padding: '5px 28px 5px 12px', cursor: 'pointer',
                  outline: 'none', appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23c8943a' opacity='0.6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
                }}
              >
                {graphCampaignRoots.map(f => (
                  <option key={f.id} value={f.id} style={{ background: 'var(--ch-card-bg)', color: 'var(--ch-text-primary)' }}>
                    {f.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {webReadOnly && (
            <span
              style={{
                display: 'inline-block',
                fontFamily: 'var(--ch-font-display)',
                fontSize: '9px',
                letterSpacing: '0.14em',
                color: 'var(--ch-text-accent)',
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid rgba(200,148,58,0.3)',
                background: 'rgba(200,148,58,0.08)',
                textAlign: 'center',
                lineHeight: 1.35,
              }}
            >
              Web view only — this campaign is marked completed
            </span>
          )}
        </div>
      )}

      {/* Legend — anchored below the toolbar row so it never overlaps it */}
      <div ref={tutorialRefs?.legend || null}>
        <LegendPanel
          selectedNoteId={selectedNoteId}
          edgeTheme={edgeTheme}
          textPrimary={theme.colors.textPrimary}
          tutorialRefs={tutorialRefs}
          showZoomHud={showZoomHud}
          onToggleZoomHud={() => setShowZoomHud((v) => !v)}
          zoomHudLive={zoomHudLive}
        />
      </div>

      {/* Toolbar — top-right: buttons first, status hints below (so hints never sit above the buttons) */}
      <div style={{ position: 'absolute', top: 8, right: 16, zIndex: 15, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', maxWidth: 'calc(100% - 200px)' }}>
        {/* Action buttons — always rendered for collision measurement; dropdown overlays when narrow */}
        <div style={{ position: 'relative' }}>
          {/* ··· dropdown trigger — shown when inline buttons would collide with campaign selector */}
          {shouldCollapseToolbar && (
            <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 2 }}>
              <button
                ref={tutorialRefs?.overflowMenu || null}
                onClick={() => setShowToolMenu(v => !v)}
                style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', letterSpacing: '0.2em', padding: isMobile ? '10px 16px' : '6px 12px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', background: showToolMenu ? 'rgba(200,148,58,0.15)' : 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', color: 'rgba(200,148,58,0.6)' }}
              >{isMobile ? 'MENU' : '···'}</button>
              {showToolMenu && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 30, background: 'var(--ch-card-bg)', border: '1px solid var(--ch-border-strong)', borderRadius: '4px', padding: '5px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: isMobile ? '160px' : '140px', boxShadow: '0 6px 24px rgba(0,0,0,0.7)' }}>
                  <button
                    ref={shouldCollapseToolbar ? (tutorialRefs?.btnConnect || null) : null}
                    onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitTheoryMode(); exitShipMode(); is3D ? setConnectMode(v => !v) : connectMode ? exitConnectMode() : setConnectMode(true); setShowToolMenu(false); })}
                    style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: connectMode ? 'rgba(58,139,196,0.2)' : 'transparent', border: `1px solid ${connectMode ? 'rgba(58,139,196,0.4)' : 'rgba(200,148,58,0.12)'}`, color: connectMode ? 'rgba(58,196,226,0.9)' : 'rgba(200,148,58,0.7)' }}>
                    {connectMode ? '✕ Cancel Connect' : '⟵⟶ Connect'}
                  </button>
                  <button
                    ref={shouldCollapseToolbar ? (tutorialRefs?.btnPath || null) : null}
                    onClick={() => guardStandardMapOnly(() => { exitConnectMode(); exitTheoryMode(); exitShipMode(); pathMode ? exitPathMode() : setPathMode(true); setShowToolMenu(false); })}
                    style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: pathMode ? 'rgba(139,196,58,0.18)' : 'transparent', border: `1px solid ${pathMode ? 'rgba(139,196,58,0.4)' : 'rgba(200,148,58,0.12)'}`, color: pathMode ? 'rgba(180,226,100,0.9)' : 'rgba(200,148,58,0.7)' }}>
                    {pathMode ? '✕ Cancel Path' : '⬡ Find Path'}
                  </button>
                  {!effectiveIs3D && (
                    <>
                      <button
                        ref={shouldCollapseToolbar ? (tutorialRefs?.btnTheory || null) : null}
                        onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitConnectMode(); exitShipMode(); theoryMode ? exitTheoryMode() : setTheoryMode(true); setShowToolMenu(false); })}
                        style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: theoryMode ? 'rgba(150,100,200,0.2)' : 'transparent', border: `1px solid ${theoryMode ? 'rgba(180,130,220,0.45)' : 'rgba(200,148,58,0.12)'}`, color: theoryMode ? 'rgba(200,170,240,0.95)' : 'rgba(200,148,58,0.7)' }}>
                        {theoryMode ? '✕ Theory' : '◇ Theory'}
                      </button>
                      <button
                        ref={shouldCollapseToolbar ? (tutorialRefs?.btnShip || null) : null}
                        onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitConnectMode(); exitTheoryMode(); shipMode ? exitShipMode() : setShipMode(true); setShowToolMenu(false); })}
                        style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: shipMode ? 'rgba(220,80,140,0.18)' : 'transparent', border: `1px solid ${shipMode ? 'rgba(255,120,170,0.45)' : 'rgba(200,148,58,0.12)'}`, color: shipMode ? 'rgba(255,170,200,0.95)' : 'rgba(200,148,58,0.7)' }}>
                        {shipMode ? '✕ Ship' : '♥ Ship'}
                      </button>
                    </>
                  )}
                  <button
                    ref={shouldCollapseToolbar ? (tutorialRefs?.btn3d || null) : null}
                    onClick={() => { setIs3D(v => !v); exitConnectMode(); exitPathMode(); exitTheoryMode(); exitShipMode(); setShowToolMenu(false); }}
                    style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: effectiveIs3D ? 'rgba(58,139,196,0.15)' : 'transparent', border: `1px solid ${effectiveIs3D ? 'rgba(58,139,196,0.3)' : 'rgba(200,148,58,0.12)'}`, color: effectiveIs3D ? 'rgba(139,196,226,0.8)' : 'rgba(200,148,58,0.7)' }}>
                    {effectiveIs3D ? '↩ 2D View' : '◈ 3D View'}
                  </button>
                  {!effectiveIs3D && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.16em', color: 'rgba(200,148,58,0.45)', padding: '2px 4px 0' }}>LAYOUT</div>
                      {renderLayoutMenuItems(() => setShowToolMenu(false), {
                        layoutTutorialRef: shouldCollapseToolbar ? tutorialRefs?.btnExpand : null,
                      })}
                    </div>
                  )}
                  {!effectiveIs3D && (
                    <button onClick={() => { setShowZoomHud(v => !v); setShowToolMenu(false); }}
                      style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: showZoomHud ? 'rgba(200,148,58,0.15)' : 'transparent', border: `1px solid ${showZoomHud ? 'rgba(200,148,58,0.35)' : 'rgba(200,148,58,0.12)'}`, color: showZoomHud ? '#c8943a' : 'rgba(200,148,58,0.7)' }}>
                      {showZoomHud ? '✕ Zoom HUD' : '⌖ Zoom HUD'}
                    </button>
                  )}
                  {isDMOfActiveCampaign && (
                    <button
                      ref={shouldCollapseToolbar ? (tutorialRefs?.btnDmView || null) : null}
                      onClick={() => { setDmView(v => !v); setShowToolMenu(false); }}
                      style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: dmView ? 'rgba(200,148,58,0.2)' : 'transparent', border: `1px solid ${dmView ? 'rgba(200,148,58,0.4)' : 'rgba(200,148,58,0.12)'}`, color: dmView ? '#c8943a' : 'rgba(200,148,58,0.7)' }}>
                      ⚔ DM View
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inline buttons — always rendered so ref can measure width; hidden when narrow */}
          <div ref={toolbarRef} style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap', justifyContent: 'flex-end', visibility: shouldCollapseToolbar ? 'hidden' : 'visible', pointerEvents: shouldCollapseToolbar ? 'none' : 'auto' }}>
            <button
              ref={!shouldCollapseToolbar ? (tutorialRefs?.btnConnect || null) : null}
              onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitTheoryMode(); exitShipMode(); if (is3D) { setConnectMode(v => !v); } else { connectMode ? exitConnectMode() : setConnectMode(true); } })}
              style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: connectMode ? 'rgba(58,139,196,0.2)' : 'rgba(200,148,58,0.08)', border: `1px solid ${connectMode ? 'rgba(58,139,196,0.5)' : 'rgba(200,148,58,0.25)'}`, color: connectMode ? 'rgba(58,196,226,0.9)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{connectMode ? '✕ Cancel' : '⟵⟶ Connect'}</button>
            <button
              ref={!shouldCollapseToolbar ? (tutorialRefs?.btnPath || null) : null}
              onClick={() => guardStandardMapOnly(() => { exitConnectMode(); exitTheoryMode(); exitShipMode(); pathMode ? exitPathMode() : setPathMode(true); })}
              style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: pathMode ? 'rgba(139,196,58,0.18)' : 'rgba(200,148,58,0.08)', border: `1px solid ${pathMode ? 'rgba(139,196,58,0.5)' : 'rgba(200,148,58,0.25)'}`, color: pathMode ? 'rgba(180,226,100,0.9)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{pathMode ? '✕ Cancel' : '⬡ Find Path'}</button>
                  {!effectiveIs3D && (
              <>
                <button
                  ref={!shouldCollapseToolbar ? (tutorialRefs?.btnTheory || null) : null}
                  onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitConnectMode(); exitShipMode(); theoryMode ? exitTheoryMode() : setTheoryMode(true); })}
                  title="Add a speculative theory link (dashed violet)"
                  style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: theoryMode ? 'rgba(150,100,200,0.2)' : 'rgba(200,148,58,0.08)', border: `1px solid ${theoryMode ? 'rgba(180,130,220,0.5)' : 'rgba(200,148,58,0.25)'}`, color: theoryMode ? 'rgba(200,170,240,0.95)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
                >{theoryMode ? '✕ Theory' : '◇ Theory'}</button>
                <button
                  ref={!shouldCollapseToolbar ? (tutorialRefs?.btnShip || null) : null}
                  onClick={() => guardStandardMapOnly(() => { if (pathMode) exitPathMode(); exitConnectMode(); exitTheoryMode(); shipMode ? exitShipMode() : setShipMode(true); })}
                  title="Ship two NPC/Character notes (dashed pink)"
                  style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: shipMode ? 'rgba(220,80,140,0.18)' : 'rgba(200,148,58,0.08)', border: `1px solid ${shipMode ? 'rgba(255,120,170,0.5)' : 'rgba(200,148,58,0.25)'}`, color: shipMode ? 'rgba(255,170,200,0.95)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
                >{shipMode ? '✕ Ship' : '♥ Ship'}</button>
              </>
            )}
            <button
              ref={!shouldCollapseToolbar ? (tutorialRefs?.btn3d || null) : null}
              onClick={() => { setIs3D(v => !v); exitConnectMode(); exitPathMode(); exitTheoryMode(); exitShipMode(); }}
              style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: effectiveIs3D ? 'rgba(58,139,196,0.15)' : 'rgba(200,148,58,0.08)', border: `1px solid ${effectiveIs3D ? 'rgba(58,139,196,0.4)' : 'rgba(200,148,58,0.25)'}`, color: effectiveIs3D ? 'rgba(139,196,226,0.8)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{effectiveIs3D ? '2D' : '3D'}</button>
            {!effectiveIs3D && (
              <div style={{ position: 'relative' }}>
                <button
                  ref={!shouldCollapseToolbar ? (tutorialRefs?.btnExpand || null) : null}
                  onClick={() => setShowLayoutMenu(v => !v)}
                  title="Layout tools — highlight new nodes or organize the graph"
                  style={{
                    fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer',
                    background: (showLayoutMenu || highlightNewActive || organizePreview) ? 'rgba(200,148,58,0.18)' : 'rgba(200,148,58,0.08)',
                    border: `1px solid ${(showLayoutMenu || highlightNewActive) ? 'rgba(200,148,58,0.45)' : 'rgba(200,148,58,0.25)'}`,
                    color: (showLayoutMenu || highlightNewActive) ? '#c8943a' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap',
                  }}
                >
                  ⊹ Layout ▾{unseenCount > 0 ? ` · ${unseenCount}` : ''}
                </button>
                {showLayoutMenu && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 30,
                    background: 'var(--ch-card-bg)', border: '1px solid var(--ch-border-strong)', borderRadius: '4px',
                    padding: '5px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '168px',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
                  }}>
                    {renderLayoutMenuItems(() => setShowLayoutMenu(false))}
                  </div>
                )}
              </div>
            )}
            {!effectiveIs3D && (
              <button
                onClick={() => setShowZoomHud(v => !v)}
                title={showZoomHud ? 'Hide zoom scale overlay' : 'Show zoom scale, FPS, and performance zone'}
                style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: showZoomHud ? 'rgba(200,148,58,0.18)' : 'rgba(200,148,58,0.08)', border: `1px solid ${showZoomHud ? 'rgba(200,148,58,0.45)' : 'rgba(200,148,58,0.25)'}`, color: showZoomHud ? '#c8943a' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
              >{showZoomHud ? '✕ HUD' : '⌖ Zoom/FPS'}</button>
            )}
            {isDMOfActiveCampaign && (
              <button ref={!shouldCollapseToolbar ? (tutorialRefs?.btnDmView || null) : null} onClick={() => setDmView(v => !v)} title={dmView ? 'Showing DM-only notes — click to hide' : 'Show DM-only notes'}
                style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: dmView ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${dmView ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.1)'}`, color: dmView ? '#c8943a' : 'var(--ch-text-primary-30)', whiteSpace: 'nowrap' }}
              >⚔ DM View</button>
            )}
          </div>
        </div>

        {/* Status / hints — below the button row */}
        {(layoutHint || highlightNewActive) && (
          <div style={{
            fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.1em', padding: '6px 12px',
            background: highlightNewActive ? 'rgba(200,148,58,0.14)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${highlightNewActive ? 'rgba(200,148,58,0.4)' : 'rgba(200,148,58,0.2)'}`,
            borderRadius: '3px', color: highlightNewActive ? '#e8c060' : 'var(--ch-text-primary-75)', maxWidth: 'min(92vw, 420px)', textAlign: 'right',
          }}>
            {layoutHint || 'Acknowledge each new node'}
            {highlightNewActive && (
              <button type="button" onClick={exitHighlightNewMode} style={{ marginLeft: '10px', fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.12em', padding: '2px 6px', borderRadius: '2px', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(200,148,58,0.35)', color: 'rgba(200,148,58,0.8)' }}>Cancel</button>
            )}
          </div>
        )}
        {(connectMode || theoryMode || shipMode || pathMode || pathResult) && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(connectMode || theoryMode || shipMode) && !pathMode && (
              <div style={{
                fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px',
                background: theoryMode ? 'rgba(150,100,200,0.15)' : shipMode ? 'rgba(220,80,140,0.12)' : 'rgba(58,139,196,0.15)',
                border: `1px solid ${theoryMode ? 'rgba(180,130,220,0.45)' : shipMode ? 'rgba(255,120,170,0.4)' : 'rgba(58,139,196,0.4)'}`,
                borderRadius: '3px',
                color: theoryMode ? 'rgba(200,170,240,0.95)' : shipMode ? 'rgba(255,170,200,0.95)' : 'rgba(58,196,226,0.9)',
                whiteSpace: 'nowrap',
              }}>
                {connectSource ? `FROM: ${connectSource.title.slice(0, 20)} → click target` : 'Click source node'}
              </div>
            )}
            {pathMode && !pathResult && (
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(139,196,58,0.12)', border: '1px solid rgba(139,196,58,0.35)', borderRadius: '3px', color: 'rgba(180,226,100,0.9)', whiteSpace: 'nowrap' }}>
                {pathSource ? `FROM: ${(pathSource.title || pathSource.name || '').slice(0, 20)} → click target` : 'Click source node'}
              </div>
            )}
            {pathResult && !pathResult.found && (
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(196,80,58,0.12)', border: '1px solid rgba(196,80,58,0.35)', borderRadius: '3px', color: 'rgba(226,140,100,0.9)', whiteSpace: 'nowrap' }}>
                No path found between these nodes
              </div>
            )}
            {pathResult?.found && (
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(139,196,58,0.12)', border: '1px solid rgba(139,196,58,0.35)', borderRadius: '3px', color: 'rgba(180,226,100,0.9)', whiteSpace: 'nowrap' }}>
                {pathResult.paths.length} path{pathResult.paths.length > 1 ? 's' : ''} · {pathResult.paths[0].length - 1} hops
              </div>
            )}
          </div>
        )}
      </div>

      {organizePreview && !effectiveIs3D && (
        <div style={{
          position: 'absolute', bottom: showZoomHud ? 88 : 24, left: '50%', transform: 'translateX(-50%)', zIndex: 25,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'auto',
        }}>
          <div style={{
            fontFamily: 'var(--ch-font-display)', fontSize: '10px', letterSpacing: '0.12em', color: 'var(--ch-text-primary-90)',
            background: 'rgba(7,8,14,0.94)', border: '1px solid rgba(200,148,58,0.35)', borderRadius: '4px',
            padding: '10px 14px', textAlign: 'center', maxWidth: 'min(92vw, 380px)', lineHeight: 1.45,
          }}>
            Preview layout — only nodes you have not moved by hand were reorganized
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={confirmOrganizePreview}
              style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.14em', padding: '8px 16px', borderRadius: '3px', cursor: 'pointer', background: 'rgba(200,148,58,0.22)', border: '1px solid rgba(200,148,58,0.5)', color: '#e8c060' }}>
              Confirm
            </button>
            <button type="button" onClick={cancelOrganizePreview}
              style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.14em', padding: '8px 16px', borderRadius: '3px', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--ch-text-primary-75)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 3D graph overlay */}
      {effectiveIs3D && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
          <GraphView3D
            notes={renderNotes}
            connections={renderConnections}
            onSelectNote={onSelectNote}
            onOpenNote={onOpenNote}
            activeCampaignId={activeCampaignId}
            connectMode={connectMode}
            onExitConnectMode={exitConnectMode}
            onCreateConnection={safeCreateConnection}
            pathMode={pathMode}
            pathSource={pathSource}
            onPathSourceSet={(src) => setPathSource(src)}
            onPathResult={(result) => setPathResult(result)}
            onExitPathMode={exitPathMode}
            isMobile={isMobile}
            tutorialRefs={tutorialRefs}
          />
        </div>
      )}

      {visibleNotes.length === 0 && !devFixture && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', opacity: 0.25 }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '18px', color: 'var(--ch-accent)', marginBottom: '8px' }}>No notes in this campaign</div>
            <div style={{ fontFamily: 'var(--ch-font-body)', fontSize: '14px', color: 'var(--ch-text-primary)' }}>Create notes and they'll appear here</div>
          </div>
        </div>
      )}
      {devGraphToolsEnabled && showDevPanel && (
        <GraphDevTools
          rendererPref={rendererPref}
          activeEngine={activeEngine}
          fixtureActive={!!devFixture}
          nodeCount={renderNotes.length}
          edgeCount={renderConnections.length}
          graphScore={graphRenderScore}
          scoreThreshold={effectiveGraphScoreThreshold(devScoreThreshold)}
          onSetRendererPref={setRendererPref}
          onSetScoreThreshold={applyDevScoreThreshold}
          onLoadFixture={loadDevFixture}
          onClearFixture={clearDevFixture}
          onOpenSigmaBench={() => {
            try { localStorage.setItem('chronicler_dev_sigma_bench', '1'); } catch (e) {}
            setSigmaBench(true);
          }}
        />
      )}
    </div>
  );
});

/**
 * Wires Cytoscape once per mount: select/open, connect/theory/ship links, path finder, edge edit, hover preview.
 * Handlers read graphHandlersRef.current so callbacks stay fresh without rebinding listeners.
 */
function bindEvents(cy, graphHandlersRef, hoverTimerRef, suppressHoverRef, connectModeRef, connectSourceRef, editingEdgeRef, pathModeRef, pathSourceRef, theoryModeRef, shipModeRef, canonAdjRef, highlightStateRef, highlightNewModeRef) {
  const lastClickRef = { id: null, time: 0 };

  cy.on('tap', 'node', (e) => {
    if (highlightNewModeRef.current) {
      if (e.target.hasClass('new-highlight')) {
        graphHandlersRef.current.acknowledgeNewNode(e.target.id());
      }
      return;
    }

    const {
      onSelectNote, onOpenNote, onCreateConnection, setConnectSource, finishActiveLinkMode,
      setPathSource, setPathResult,
    } = graphHandlersRef.current;

    const inLinkMode = connectModeRef.current || theoryModeRef.current || shipModeRef.current;
    if (inLinkMode) {
      if (!connectSourceRef.current) {
        setConnectSource({ id: e.target.id(), title: e.target.data('label') });
        e.target.addClass('connect-source');
        if (theoryModeRef.current) e.target.addClass('theory-source');
        if (shipModeRef.current) e.target.addClass('ship-source');
        cy.nodes().not(e.target).addClass('connect-dim');
      } else {
        const sourceId = connectSourceRef.current.id;
        const targetId = e.target.id();
        if (sourceId !== targetId) {
          if (theoryModeRef.current) onCreateConnection(parseInt(sourceId), parseInt(targetId), { connection_kind: 'theory' });
          else if (shipModeRef.current) onCreateConnection(parseInt(sourceId), parseInt(targetId), { connection_kind: 'ship' });
          else onCreateConnection(parseInt(sourceId), parseInt(targetId));
        }
        finishActiveLinkMode();
      }
      return;
    }

    if (pathModeRef.current) {
      const id = e.target.id();
      const title = e.target.data('label');
      if (!pathSourceRef.current) {
        setPathSource({ id, title });
        clearHighlightClasses(cy, highlightStateRef);
        let touched = cy.collection();
        cy.batch(() => {
          const src = cy.getElementById(id);
          src.addClass('tier-0');
          touched = touched.union(src);
          const dimNodes = cy.nodes().not(`#${id}`);
          dimNodes.addClass('path-pick-dim');
          touched = touched.union(dimNodes);
          const dimEdges = cy.edges().addClass('path-pick-dim');
          touched = touched.union(dimEdges);
        });
        highlightStateRef.current.touched = touched;
      } else {
        const srcId = pathSourceRef.current.id;
        if (srcId === id) return;
        const paths = getAllShortestPaths(canonAdjRef.current, srcId, id, 3);
        clearHighlightClasses(cy, highlightStateRef);
        let touched = cy.collection();
        cy.batch(() => {
          if (paths.length === 0) {
            setPathResult({ found: false, paths: [] });
            const a = cy.getElementById(srcId).addClass('tier-0');
            const b = cy.getElementById(id).addClass('tier-0');
            touched = touched.union(a).union(b);
            const floorNodes = cy.nodes().not(`#${srcId}`).not(`#${id}`).addClass('path-floor');
            touched = touched.union(floorNodes);
          } else {
            setPathResult({ found: true, paths });
            const pathNodeIds = new Set();
            const pathEdgePairs = new Set();
            paths.forEach(path => {
              path.forEach(nid => pathNodeIds.add(nid));
              for (let i = 0; i < path.length - 1; i++) {
                const a = path[i], b = path[i + 1];
                pathEdgePairs.add([a, b].sort().join('_'));
              }
            });
            cy.nodes().forEach(n => {
              if (pathNodeIds.has(n.id())) n.addClass('path-node');
              else n.addClass('path-floor');
              touched = touched.union(n);
            });
            cy.edges().forEach(edge => {
              const pair = [edge.source().id(), edge.target().id()].sort().join('_');
              if (pathEdgePairs.has(pair)) edge.addClass('path-edge');
              else edge.addClass('path-floor');
              touched = touched.union(edge);
            });
          }
        });
        highlightStateRef.current.touched = touched;
      }
      return;
    }

    const now = Date.now();
    const nodeId = e.target.id();
    if (nodeId === lastClickRef.id && now - lastClickRef.time < 350) {
      onOpenNote(parseInt(nodeId));
      lastClickRef.id = null;
    } else {
      lastClickRef.id = nodeId;
      lastClickRef.time = now;
      onSelectNote(parseInt(nodeId));
    }
  });

  cy.on('tap', (e) => {
    if (e.target === cy) {
      clearHighlightClasses(cy, highlightStateRef);
      const { setEditingEdge, setConnectSource } = graphHandlersRef.current;
      if (editingEdgeRef.current) setEditingEdge(null);
      if (connectModeRef.current || theoryModeRef.current || shipModeRef.current) setConnectSource(null);
    }
  });

  cy.on('tap', 'edge', (e) => {
    if (highlightNewModeRef.current) return;
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
    const { setEditingEdge } = graphHandlersRef.current;
    const edge = e.target;
    const connId = edge.data('connId');
    if (!connId) return;
    let gimmickKind = null;
    if (edge.hasClass('kind-theory')) gimmickKind = 'theory';
    else if (edge.hasClass('kind-ship')) gimmickKind = 'ship';
    const pos = edge.midpoint();
    const pan = cy.pan();
    const zoom = cy.zoom();
    const x = pos.x * zoom + pan.x;
    const y = pos.y * zoom + pan.y;
    setEditingEdge({
      id: connId,
      label: edge.data('label') || '',
      direction: edge.data('direction') || 'bidirectional',
      sourceTitle: edge.source().data('label') || '',
      targetTitle: edge.target().data('label') || '',
      x,
      y,
      gimmickKind,
    });
  });

  cy.on('mouseover', 'node', (e) => {
    if (highlightNewModeRef.current) return;
    if (suppressHoverRef.current) return;
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
    if (cy.nodes().length > HOVER_HIGHLIGHT_MAX_NODES) return;
    const nodeId = e.target.id();
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (suppressHoverRef.current) return;
      if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
      if (cy.nodes().length > HOVER_HIGHLIGHT_MAX_NODES) return;
      const tiers = getTiersFromAdj(canonAdjRef.current, nodeId, MAX_HOPS);
      applyTierHighlight(cy, tiers, MAX_HOPS, highlightStateRef);
    }, HOVER_DELAY_MS);
  });

  cy.on('mouseout', 'node', () => {
    if (highlightNewModeRef.current) return;
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
    clearTimeout(hoverTimerRef.current);
    if (!suppressHoverRef.current) clearHighlightClasses(cy, highlightStateRef);
  });
}

// Post-layout label de-overlap: iteratively push nodes apart until no label bboxes intersect
function separateLabels(cy, posKey, maxPasses = 12) {
  const PAD = 8; // extra clearance around each label bbox
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    const nodes = cy.nodes().toArray();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const ba = a.boundingBox({ includeLabels: true, includeOverlays: false });
        const bb = b.boundingBox({ includeLabels: true, includeOverlays: false });

        const overlapX = (ba.x1 - PAD < bb.x2 + PAD) && (ba.x2 + PAD > bb.x1 - PAD);
        const overlapY = (ba.y1 - PAD < bb.y2 + PAD) && (ba.y2 + PAD > bb.y1 - PAD);
        if (!overlapX || !overlapY) continue;

        // Vector from a centre to b centre
        const ax = (ba.x1 + ba.x2) / 2, ay = (ba.y1 + ba.y2) / 2;
        const bx = (bb.x1 + bb.x2) / 2, by = (bb.y1 + bb.y2) / 2;
        let dx = bx - ax, dy = by - ay;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dist; dy /= dist;

        // Push apart by half the overlap depth on each axis
        const pushX = ((ba.x2 + PAD) - (bb.x1 - PAD)) / 2 * dx;
        const pushY = ((ba.y2 + PAD) - (bb.y1 - PAD)) / 2 * dy;
        const pa = a.position(), pb = b.position();
        const aLocked = a.locked();
        const bLocked = b.locked();
        if (aLocked && bLocked) continue;
        if (aLocked) {
          b.position({ x: pb.x + pushX * 2, y: pb.y + pushY * 2 });
        } else if (bLocked) {
          a.position({ x: pa.x - pushX * 2, y: pa.y - pushY * 2 });
        } else {
          a.position({ x: pa.x - pushX, y: pa.y - pushY });
          b.position({ x: pb.x + pushX, y: pb.y + pushY });
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Persist the de-overlapped positions
  if (posKey) {
    const pos = {};
    cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
    try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch (e) {}
  }
}

/**
 * Truncates note titles for compact edge-direction buttons in the graph editor.
 * @param {string} title
 * @returns {string}
 */
function truncateGraphTitle(title) {
  const s = String(title || '');
  return s.length > 16 ? `${s.slice(0, 14)}…` : s;
}

/**
 * Returns a Cytoscape edge class for connection direction.
 * @param {{ direction?: string }} conn
 * @returns {string}
 */
function connectionDirectionClass(conn) {
  const d = conn.direction || 'bidirectional';
  if (d === 'forward') return 'dir-forward';
  if (d === 'reverse') return 'dir-reverse';
  return 'dir-bidirectional';
}

/**
 * Endpoint arrows for one-way edges only (bidirectional = no arrowheads).
 * @param {typeof DEFAULT_EDGE_THEME} theme
 * @returns {object[]}
 */
function buildDirectionArrowStyles(theme) {
  const rules = [];
  for (const { key } of EDGE_KIND_META) {
    const t = theme[key] || DEFAULT_EDGE_THEME[key];
    const b = Math.max(0.05, Math.min(1, t.brightness));
    const arrowOp = Math.min(1, b * 1.6);
    rules.push(
      {
        selector: `edge.kind-${key}.dir-forward`,
        style: {
          'target-arrow-shape': 'triangle',
          'target-arrow-color': t.color,
          'target-arrow-opacity': arrowOp,
          'arrow-scale': 1.1,
        },
      },
      {
        selector: `edge.kind-${key}.dir-reverse`,
        style: {
          'source-arrow-shape': 'triangle',
          'source-arrow-color': t.color,
          'source-arrow-opacity': arrowOp,
          'arrow-scale': 1.1,
        },
      },
      {
        selector: `edge.kind-${key}.dir-bidirectional`,
        style: { 'source-arrow-shape': 'none', 'target-arrow-shape': 'none' },
      },
    );
  }
  return rules;
}

/**
 * Builds per-kind edge line + label colors from the user theme.
 * @param {typeof DEFAULT_EDGE_THEME} theme
 * @returns {object[]}
 */
function buildKindEdgeStyles(theme) {
  return EDGE_KIND_META.map(({ key }) => {
    const t = theme[key] || DEFAULT_EDGE_THEME[key];
    const b = Math.max(0.05, Math.min(1, t.brightness));
    const labelOp = Math.min(1, b * 1.1);
    const highlightOp = Math.min(1, b * 2.2);
    const base = {
      'line-color': t.color,
      'line-opacity': b,
      'color': t.color,
      'text-opacity': labelOp,
    };
    if (key === 'theory' || key === 'ship') base['line-style'] = 'dashed';
    else base['line-style'] = 'solid';
    return [
      { selector: `edge.kind-${key}`, style: base },
      {
        selector: `edge.kind-${key}.highlighted`,
        style: {
          'line-color': t.color,
          'line-opacity': highlightOp,
          'text-opacity': Math.min(1, highlightOp * 1.05),
          'opacity': 1,
        },
      },
    ];
  }).flat();
}

/**
 * Pushes an updated Cytoscape stylesheet and refreshes edge rendering.
 * @param {import('cytoscape').Core|null} cy
 * @param {typeof DEFAULT_EDGE_THEME} theme
 */
/** Memoized Cytoscape stylesheet JSON — theme edits are infrequent. */
const styleCacheByTheme = new Map();
const STYLE_CACHE_VERSION = 7;

/**
 * Returns cached buildStyle output for a full Chronicler theme.
 * @param {import('../theme/schema.js').ChroniclerTheme} theme
 * @returns {object[]}
 */
function getCachedStyle(theme) {
  const key = `${STYLE_CACHE_VERSION}:${JSON.stringify(theme)}`;
  if (!styleCacheByTheme.has(key)) {
    styleCacheByTheme.set(key, buildStyle(theme));
  }
  return styleCacheByTheme.get(key);
}

/**
 * Re-applies graph stylesheet to a live Cytoscape instance.
 * @param {import('cytoscape').Core|null} cy
 * @param {import('../theme/schema.js').ChroniclerTheme} theme
 */
function applyGraphStyle(cy, theme) {
  if (!cy) return;
  cy.style().fromJson(getCachedStyle(theme));
  cy.style().update();
}

/**
 * Builds Cytoscape stylesheet from site theme tokens (edges, labels, canvas).
 * @param {import('../theme/schema.js').ChroniclerTheme} theme
 */
function buildStyle(theme) {
  const edgeTheme = theme?.edges || DEFAULT_EDGE_THEME;
  const labelColor = theme?.colors?.textPrimary || 'var(--ch-text-primary)';
  const graphBg = theme?.colors?.graphBg || theme?.colors?.shellBg || '#07080e';
  const displayFont = theme?.fonts?.display || 'Cinzel';
  // Node opacity per tier using HOP_OPACITY table
  const nodeTierStyles = HOP_OPACITY.map((op, i) => {
    const base = { 'opacity': op };
    if (i === 0) Object.assign(base, { 'background-opacity': 0.7, 'border-width': 3, 'border-opacity': 1, 'width': 46, 'height': 46, 'font-size': '12px' });
    if (i === 1) Object.assign(base, { 'background-opacity': 0.35, 'border-width': 2, 'border-opacity': 0.9, 'width': 38, 'height': 38 });
    return { selector: `node.tier-${i}`, style: base };
  });
  const canon = edgeTheme.canon || DEFAULT_EDGE_THEME.canon;
  const canonB = Math.max(0.05, Math.min(1, canon.brightness));
  // Edge opacity per tier: edge takes opacity of its deeper endpoint
  const edgeTierStyles = HOP_OPACITY.map((op, i) => ({
    selector: `edge.tier-${i}`,
    style: {
      'opacity': op,
      'line-color': canon.color,
      'line-opacity': Math.min(1, canonB * 2.2) * op,
      'width': i <= 1 ? 2 : 1.5,
    },
  }));

  return [
    { selector: 'core', style: { 'background-color': graphBg } },
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)', 'background-opacity': 0.15,
        'border-color': 'data(color)', 'border-width': 1.5, 'border-opacity': 0.8,
        'label': 'data(label)', 'color': labelColor, 'font-family': `${displayFont}, serif`, 'font-size': '11px',
        'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 6,
        'text-background-color': graphBg, 'text-background-opacity': 0.8, 'text-background-padding': '3px',
        'text-wrap': 'ellipsis', 'text-max-width': '120px',
        'width': 34, 'height': 34,
        'transition-property': 'opacity, width, height, border-width, background-opacity, border-opacity, font-size',
        'transition-duration': `${HOVER_TRANSITION_MS}ms`,
        'transition-timing-function': 'ease-in-out',
      },
    },
    ...nodeTierStyles,
    { selector: 'node.no-node-labels', style: { 'text-opacity': 0 } },
    {
      selector: 'node.new-highlight',
      style: {
        'border-color': '#e8c060',
        'border-width': 4,
        'border-opacity': 1,
        'overlay-color': '#c8943a',
        'overlay-opacity': 0.35,
        'overlay-padding': 10,
      },
    },
    {
      selector: 'node.new-highlight-flash',
      style: {
        'border-width': 5,
        'overlay-opacity': 0.65,
      },
    },
    { selector: 'node.dimmed',     style: { 'opacity': FLOOR_OPACITY } },
    { selector: 'node.path-pick-dim', style: { 'opacity': PATH_FIND_PICK_DIM_OPACITY } },
    { selector: 'edge.path-pick-dim', style: { 'opacity': PATH_FIND_PICK_DIM_OPACITY } },
    { selector: 'node.path-node',  style: { 'opacity': 1, 'background-opacity': 0.7, 'border-width': 3, 'border-opacity': 1, 'width': 44, 'height': 44 } },
    { selector: 'node.path-floor', style: { 'opacity': FLOOR_OPACITY } },
    {
      selector: 'edge',
      style: {
        'width': 2, 'line-color': canon.color, 'line-opacity': canonB,
        'curve-style': 'straight',
        'label': 'data(label)', 'font-size': '9px', 'color': canon.color,
        'text-opacity': Math.min(1, canonB * 1.1),
        'font-family': `${displayFont}, serif`,
        'text-background-color': graphBg, 'text-background-opacity': 0.75, 'text-background-padding': '2px',
        'transition-property': 'opacity, width, line-opacity',
        'transition-duration': `${HOVER_TRANSITION_MS}ms`,
        'transition-timing-function': 'ease-in-out',
      },
    },
    { selector: 'edge.no-edge-labels', style: { 'text-opacity': 0 } },
    ...buildKindEdgeStyles(edgeTheme),
    {
      selector: 'edge.kind-theory.dimmed',
      style: { 'opacity': FLOOR_OPACITY },
    },
    {
      selector: 'edge.kind-ship.dimmed',
      style: { 'opacity': FLOOR_OPACITY },
    },
    ...buildDirectionArrowStyles(edgeTheme),
    ...edgeTierStyles,
    { selector: 'edge.dimmed',     style: { 'opacity': FLOOR_OPACITY } },
    { selector: 'edge.path-edge',  style: { 'opacity': 1, 'line-color': 'rgba(200,148,58,0.85)', 'width': 4 } },
    { selector: 'edge.path-floor', style: { 'opacity': FLOOR_OPACITY } },
    { selector: 'node.connect-source', style: { 'border-color': 'rgba(58,196,226,1)', 'border-width': 3, 'background-opacity': 0.6, 'opacity': 1 } },
    { selector: 'node.theory-source', style: { 'border-color': 'rgba(180,130,240,1)', 'border-width': 3, 'background-opacity': 0.55, 'opacity': 1 } },
    { selector: 'node.ship-source', style: { 'border-color': 'rgba(255,120,175,1)', 'border-width': 3, 'background-opacity': 0.55, 'opacity': 1 } },
    { selector: 'node.connect-dim',    style: { 'opacity': 0.2 } },
    { selector: 'edge:selected',       style: { 'line-color': 'rgba(200,148,58,0.85)', 'width': 4 } },
  ];
}

function LegendPanel({ selectedNoteId, edgeTheme, textPrimary = '#e2d5bb', tutorialRefs = null, showZoomHud = false, onToggleZoomHud = null, zoomHudLive = null }) {
  const [open, setOpen] = useState(false);
  const panelW = 210;
  return (
    <div style={{
      position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
      zIndex: 10, display: 'flex', alignItems: 'stretch', pointerEvents: 'none',
    }}>
      {/* Sliding panel */}
      <div style={{
        pointerEvents: 'all',
        background: 'rgba(7,8,14,0.92)', border: '1px solid rgba(200,148,58,0.3)',
        borderLeft: 'none', borderRadius: '0 6px 6px 0',
        padding: open ? '14px 12px' : '0',
        width: open ? `${panelW}px` : '0',
        maxHeight: 'min(88vh, 720px)',
        overflowY: open ? 'auto' : 'hidden',
        overflowX: 'hidden',
        transition: 'width 0.22s ease, padding 0.22s ease',
        backdropFilter: 'blur(10px)',
        flexShrink: 0,
      }}>
        <div style={{ width: `${panelW - 24}px` }}>
          <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>CATEGORIES</div>
          {[
            { cat: 'npc', label: 'NPC' }, { cat: 'location', label: 'Location' },
            { cat: 'faction', label: 'Faction' }, { cat: 'item', label: 'Item' },
            { cat: 'event', label: 'Event' }, { cat: 'lore', label: 'Lore' },
            { cat: 'general', label: 'General' },
          ].map(({ cat, label }) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: getCategoryColor(cat), flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: 'var(--ch-text-primary-75)', letterSpacing: '0.05em' }}>{label}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px', opacity: selectedNoteId ? 1 : 0.35, transition: 'opacity 0.2s' }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', margin: '8px 0' }}>CONNECTION DEPTH</div>
            {[{ label: 'Selected', opacity: 1 }, { label: '1 hop', opacity: 0.75 }, { label: '2 hops', opacity: 0.45 }, { label: '3+ hops', opacity: 0.2 }].map(({ label, opacity }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: `rgba(200,148,58,${opacity})`, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: hexToRgba(textPrimary, Math.min(1, opacity * 0.8 + 0.4)), letterSpacing: '0.05em' }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>CONNECTIONS</div>
            {EDGE_KIND_META.map(({ key, label }) => {
              const t = edgeTheme?.[key] || DEFAULT_EDGE_THEME[key];
              const dash = key !== 'canon';
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ width: '22px', flexShrink: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${t.color}`, opacity: t.brightness }} />
                  <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: 'var(--ch-text-primary-75)', letterSpacing: '0.05em' }}>{label}</span>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
            <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>DIRECTION</div>
            {[
              { label: 'Both ways', glyph: '—' },
              { label: 'One way', glyph: '→' },
            ].map(({ label, glyph }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '11px', color: 'rgba(200,148,58,0.55)', width: '22px', flexShrink: 0, textAlign: 'center' }}>{glyph}</span>
                <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', color: 'var(--ch-text-primary-75)', letterSpacing: '0.05em' }}>{label}</span>
              </div>
            ))}
          </div>
          {onToggleZoomHud && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>ZOOM / FPS</div>
              {zoomHudLive && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '12px', color: 'var(--ch-accent)' }}>
                    {zoomHudLive.zoom.toFixed(2)}× ({Math.round(zoomHudLive.zoom * 100)}%)
                  </div>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', color: 'var(--ch-text-primary-55)', marginTop: '3px' }}>
                    {zoomHudLive.zone}
                  </div>
                  <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '8px', color: 'var(--ch-text-primary-40)', marginTop: '2px' }}>
                    {zoomHudLive.nodes} nodes · {zoomHudLive.edges} edges
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={onToggleZoomHud}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'var(--ch-font-display)', fontSize: '8px', letterSpacing: '0.08em',
                  background: showZoomHud ? 'rgba(200,148,58,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${showZoomHud ? 'rgba(200,148,58,0.35)' : 'rgba(255,255,255,0.1)'}`,
                  color: showZoomHud ? '#c8943a' : 'var(--ch-text-primary-55)',
                }}
              >
                {showZoomHud ? 'Hide zoom overlay' : 'Show zoom overlay'}
              </button>
              <div style={{ fontFamily: 'var(--ch-font-display)', fontSize: '7px', color: 'rgba(200,148,58,0.4)', marginTop: '6px', lineHeight: 1.4 }}>
                Overlay also in toolbar: ⌖ Zoom/FPS
              </div>
            </div>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '8px', fontFamily: 'var(--ch-font-display)', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.55)' }}>
            CLICK EDGE TO EDIT LABEL & DIRECTION
          </div>
        </div>
      </div>

      {/* Tab — mirrors CONTROLS tab style exactly */}
      <button
        ref={tutorialRefs?.legendTab || null}
        onClick={() => setOpen(o => !o)}
        style={{
          pointerEvents: 'all',
          background: 'rgba(7,8,14,0.92)', border: '1px solid rgba(200,148,58,0.3)',
          borderLeft: open ? '1px solid rgba(200,148,58,0.15)' : '1px solid rgba(200,148,58,0.3)',
          borderRadius: '0 6px 6px 0',
          cursor: 'pointer', padding: '10px 6px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '3px', color: 'rgba(200,148,58,0.65)', flexShrink: 0,
          backdropFilter: 'blur(10px)',
        }}
        title={open ? 'Close legend' : 'Open legend'}
      >
        <span style={{ fontFamily: 'var(--ch-font-display)', fontSize: '9px', letterSpacing: '0.05em', writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', color: 'rgba(200,148,58,0.65)' }}>LEGEND</span>
        <span style={{ fontSize: '10px', marginTop: '4px' }}>{open ? '«' : '»'}</span>
      </button>
    </div>
  );
}
