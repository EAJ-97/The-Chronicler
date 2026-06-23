import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import cytoscape from 'cytoscape';
import { getCategoryColor } from './NoteEditor.jsx';
import GraphView3D from './GraphView3D.jsx';
import api from '../api.js';
import { getGraphCampaignRoots, isUnderCompletedArchive } from '../utils/campaignTree.js';

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

const HOP_OPACITY = [1.0, 1.0, 0.85, 0.6, 0.35, 0.18, 0.08];
const FLOOR_OPACITY = 0.04;
/** While choosing the second node in Find Path, non-source nodes use this opacity (~35% dim vs full). */
const PATH_FIND_PICK_DIM_OPACITY = 0.65;
const MAX_HOPS = 6;

/** Per-kind edge appearance defaults (line, label, arrows share brightness). */
const DEFAULT_EDGE_THEME = {
  canon: { color: '#c8943a', brightness: 0.2 },
  theory: { color: '#9664c8', brightness: 0.24 },
  ship: { color: '#d05090', brightness: 0.24 },
};

const EDGE_KIND_META = [
  { key: 'canon', label: 'Canon' },
  { key: 'theory', label: 'Theory' },
  { key: 'ship', label: 'Ship' },
];

/**
 * Loads persisted edge theme from localStorage, merged with defaults.
 * @param {string} storageKey
 * @returns {typeof DEFAULT_EDGE_THEME}
 */
function loadEdgeTheme(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_EDGE_THEME };
    const merged = { ...DEFAULT_EDGE_THEME };
    for (const { key } of EDGE_KIND_META) {
      if (raw[key] && typeof raw[key] === 'object') {
        merged[key] = {
          color: typeof raw[key].color === 'string' ? raw[key].color : merged[key].color,
          brightness: Number.isFinite(raw[key].brightness) ? raw[key].brightness : merged[key].brightness,
        };
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_EDGE_THEME };
  }
}

/**
 * Converts #rrggbb to rgba with the given alpha (brightness).
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
  const h = String(hex || '#c8943a').replace('#', '');
  if (h.length !== 6) return `rgba(200,148,58,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * BFS hop depths from startId using **canonical edges only** — theory/ship links do not expand tiers or affect hover/selection halos.
 */
function getTiers(cy, startId, maxDepth = MAX_HOPS) {
  const tiers = new Map();
  const start = String(startId);
  const queue = [[start, 0]];
  tiers.set(start, 0);
  while (queue.length > 0) {
    const [id, depth] = queue.shift();
    if (depth >= maxDepth) continue;
    for (const nid of getCanonNeighborIds(cy, id)) {
      if (!tiers.has(nid)) {
        tiers.set(nid, depth + 1);
        queue.push([nid, depth + 1]);
      }
    }
  }
  return tiers;
}

/** Neighbour node ids reachable via canonical (orange) edges only — respects edge direction. */
function getCanonNeighborIds(cy, nodeId) {
  const out = [];
  const el = cy.getElementById(nodeId);
  if (!el || el.length === 0) return out;
  el.connectedEdges('.kind-canon').forEach((edge) => {
    const src = edge.source().id();
    const tgt = edge.target().id();
    const dir = edge.data('direction') || 'bidirectional';
    if (dir === 'bidirectional') {
      if (src === nodeId) out.push(tgt);
      else if (tgt === nodeId) out.push(src);
    } else if (dir === 'forward' && src === nodeId) {
      out.push(tgt);
    } else if (dir === 'reverse' && tgt === nodeId) {
      out.push(src);
    }
  });
  return out;
}

// Returns all shortest paths between src and tgt, capped at maxPaths (canonical edges only)
// Each path is an array of node id strings
function getAllShortestPaths(cy, srcId, tgtId, maxPaths = 3) {
  const src = String(srcId), tgt = String(tgtId);
  if (src === tgt) return [];

  // BFS tracking all parents for shortest-path reconstruction — only `kind-canon` edges
  const dist    = new Map([[src, 0]]);
  const parents = new Map([[src, []]]);
  const queue   = [src];
  let   found   = false;

  while (queue.length) {
    const cur = queue.shift();
    const d   = dist.get(cur);
    if (cur === tgt) { found = true; break; }
    for (const nid of getCanonNeighborIds(cy, cur)) {
      if (!dist.has(nid)) {
        dist.set(nid, d + 1);
        parents.set(nid, [cur]);
        queue.push(nid);
      } else if (dist.get(nid) === d + 1) {
        parents.get(nid).push(cur);
      }
    }
  }

  if (!found) return [];

  // Reconstruct all paths by walking parents backwards from tgt
  const paths = [];
  const stack = [[tgt, [tgt]]];
  while (stack.length && paths.length < maxPaths) {
    const [node, path] = stack.pop();
    if (node === src) { paths.push([...path].reverse()); continue; }
    for (const p of (parents.get(node) || [])) {
      stack.push([p, [...path, p]]);
    }
  }
  return paths;
}

// Get all note ids in a folder subtree (inclusive of the root folder id)
function getSubtreeIds(allNotes, rootId) {
  const ids = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    ids.add(id);
    allNotes.filter(n => n.parent_id === id).forEach(n => queue.push(n.id));
  }
  return ids;
}

export default function GraphView({ allNotes, notes, connections, onSelectNote, onOpenNote, onCreateConnection, onDeleteConnection, onUpdateConnection, selectedNoteId, currentUser, dmCampaignIds, simulatedRole, isMobile, tutorialRefs = null, tutorialForce3D = false, tutorialForce2D = false }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const isFirstMount = useRef(true);
  /** Skips redundant Cytoscape patches when parent re-renders with the same graph data. */
  const dataFingerprintRef = useRef('');
  const edgeThemeKey = `chronicler_graph_edge_theme_${currentUser?.id || 'anon'}`;
  const [edgeTheme, setEdgeThemeRaw] = useState(() => loadEdgeTheme(edgeThemeKey));
  const setEdgeTheme = useCallback((updater) => {
    setEdgeThemeRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(edgeThemeKey, JSON.stringify(next)); } catch (e) {}
      applyGraphStyle(cyRef.current, next);
      return next;
    });
  }, [edgeThemeKey]);
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

  const exitPathMode = useCallback(() => {
    setPathMode(false);
    setPathSource(null);
    setPathResult(null);
    pathModeRef.current   = false;
    pathSourceRef.current = null;
    cyRef.current?.elements().removeClass('path-node path-edge path-floor path-pick-dim');
    cyRef.current?.elements().removeClass('tier-0 tier-1 tier-2 tier-3 tier-4 tier-5 tier-6 dimmed highlighted');
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

  // Filter notes + connections to active campaign subtree
  const subtreeIds = activeCampaignId ? getSubtreeIds(allNotes || [], activeCampaignId) : null;
  const subtreeNotes = subtreeIds ? notes.filter(n => subtreeIds.has(n.id)) : notes;
  // Strip DM-only notes unless the viewer is a DM/admin with DM View enabled
  const visibleNotes = subtreeNotes.filter(n => !n.is_dm_only || (isDMOfActiveCampaign && dmView));
  const visibleNoteIds = new Set(visibleNotes.map(n => n.id));
  const visibleConnections = (subtreeIds
    ? connections.filter(c => subtreeIds.has(c.source_note_id) && subtreeIds.has(c.target_note_id))
    : connections
  ).filter(c => visibleNoteIds.has(c.source_note_id) && visibleNoteIds.has(c.target_note_id));

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

  /**
   * Places nodes that have no saved coordinates near neighbours or on an outward spiral.
   * @param {import('cytoscape').Core} cy
   * @param {string[]} addedNodeIds - node ids to position (Cytoscape string ids)
   * @param {Record<string, { x: number, y: number }>|null} savedPositions
   * @param {string} posKey - localStorage key for persisting all node positions
   */
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

  const runExpand = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const layout = cy.layout({
      name: 'cose',
      animate: true,
      animationDuration: 900,
      nodeRepulsion: () => 80000,
      idealEdgeLength: () => 200,
      nodeOverlap: 40,
      gravity: 0.25,
      numIter: 2000,
      padding: 80,
    });
    layout.one('layoutstop', () => separateLabels(cy, posKey));
    layout.run();
  }, [posKey]);

  // Initial mount
  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElements(visibleNotes, visibleConnections);
    const nodeElements = elements.filter(e => !e.data.source);
    let savedPositions = null;
    try { savedPositions = JSON.parse(localStorage.getItem(posKey)); } catch (e) {}
    const hasAnySaved = savedPositions && nodeElements.some(e => savedPositions[e.data.id]);
    const allSaved = savedPositions && nodeElements.every(e => savedPositions[e.data.id]);
    const runFullLayout = !hasAnySaved;

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      style: buildStyle(edgeTheme),
      layout: runFullLayout
        ? { name: 'cose', animate: true, animationDuration: 900, nodeRepulsion: () => 80000, idealEdgeLength: () => 200, nodeOverlap: 40, gravity: 0.25, numIter: 2000, padding: 80 }
        : { name: 'preset', positions: (node) => savedPositions[node.id()], padding: 80 },
      wheelSensitivity: 0,   // neutralize Cytoscape's wheel — we handle it ourselves
      boxSelectionEnabled: false,
      zoomingEnabled: true,
    });

    const cy = cyRef.current;

    // Restore saved positions and place only nodes that lack coordinates — never re-run cose for the whole graph.
    if (hasAnySaved && !allSaved) {
      const unsavedIds = [];
      cy.nodes().forEach(n => {
        const saved = savedPositions[n.id()];
        if (saved) n.position(saved);
        else unsavedIds.push(n.id());
      });
      placeNewGraphNodes(cy, unsavedIds, savedPositions, posKey);
    }

    // Smooth zoom — Cytoscape's built-in wheel is disabled via wheelSensitivity:0
    let zoomTarget = cy.zoom();
    let zoomRAF    = null;
    let lastWheelPos = null;
    const smoothZoom = (e) => {
      e.preventDefault();
      const delta  = e.deltaY > 0 ? 0.92 : 1.09;
      zoomTarget   = Math.min(Math.max(zoomTarget * delta, 0.1), 5);
      const containerRect = containerRef.current.getBoundingClientRect();
      lastWheelPos = {
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      };
      if (zoomRAF) return;
      const tick = () => {
        const cur  = cy.zoom();
        const diff = zoomTarget - cur;
        if (Math.abs(diff) < 0.0008) { cy.zoom({ level: zoomTarget, renderedPosition: lastWheelPos }); zoomRAF = null; return; }
        cy.zoom({ level: cur + diff * 0.18, renderedPosition: lastWheelPos });
        zoomRAF = requestAnimationFrame(tick);
      };
      zoomRAF = requestAnimationFrame(tick);
    };
    containerRef.current.addEventListener('wheel', smoothZoom, { passive: false });
    const savePositions = () => {
      const pos = {};
      cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
      try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch (e) {}
    };
    cy.on('dragfree', 'node', savePositions);
    cy.on('layoutstop', savePositions);
    // On first load with no saved positions, de-overlap labels after layout settles
    if (runFullLayout) {
      cy.one('layoutstop', () => separateLabels(cy, posKey));
    }

    dataFingerprintRef.current = buildGraphFingerprint(visibleNotes, visibleConnections);

    bindEvents(cy, onSelectNote, onOpenNote, hoverTimerRef, connectModeRef, connectSourceRef, setConnectSource, finishActiveLinkMode, safeCreateConnection, editingEdgeRef, setEditingEdge, pathModeRef, pathSourceRef, setPathSource, setPathResult, exitPathMode, theoryModeRef, shipModeRef);

    return () => {
      clearTimeout(hoverTimerRef.current);
      if (zoomRAF) cancelAnimationFrame(zoomRAF);
      containerRef.current?.removeEventListener('wheel', smoothZoom);
      cy.destroy();
      cyRef.current = null;
      isFirstMount.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId]);

  // Update graph when notes/connections change after mount
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (isFirstMount.current) { isFirstMount.current = false; return; }

    const fp = buildGraphFingerprint(visibleNotes, visibleConnections);
    if (fp === dataFingerprintRef.current) return;
    dataFingerprintRef.current = fp;

    const newElements = buildElements(visibleNotes, visibleConnections);
    const newIds = new Set(newElements.map(e => e.data.id));

    cy.elements().forEach(el => { if (!newIds.has(el.id())) el.remove(); });

    // Track which nodes are truly new (no saved position)
    let savedPositions = null;
    try { savedPositions = JSON.parse(localStorage.getItem(posKey)); } catch (e) {}
    const addedNodeIds = [];

    newElements.forEach(el => {
      if (!cy.getElementById(el.data.id).length) {
        cy.add(el);
        if (!el.data.source) addedNodeIds.push(el.data.id); // it's a node, not an edge
      } else {
        const existing = cy.getElementById(el.data.id);
        if (el.data.label !== undefined) existing.data('label', el.data.label);
        if (el.data.source) {
          if (el.data.direction !== undefined) existing.data('direction', el.data.direction);
          if (el.classes) existing.classes(el.classes);
        }
      }
    });

    placeNewGraphNodes(cy, addedNodeIds, savedPositions, posKey);

    cy.removeAllListeners();
    const savePositions = () => {
      const pos = {};
      cy.nodes().forEach(n => { pos[n.id()] = { ...n.position() }; });
      try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch (e) {}
    };
    cy.on('dragfree', 'node', savePositions);
    cy.on('layoutstop', savePositions);
    bindEvents(cy, onSelectNote, onOpenNote, hoverTimerRef, connectModeRef, connectSourceRef, setConnectSource, finishActiveLinkMode, safeCreateConnection, editingEdgeRef, setEditingEdge, pathModeRef, pathSourceRef, setPathSource, setPathResult, exitPathMode, theoryModeRef, shipModeRef);
  }, [visibleNotes, visibleConnections]);

  // Re-apply edge colors / arrows when the user adjusts appearance controls
  useEffect(() => {
    applyGraphStyle(cyRef.current, edgeTheme);
  }, [edgeTheme]);

  // Tiered highlight
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('tier-0 tier-1 tier-2 tier-3 dimmed highlighted');
    if (selectedNoteId) {
      const tiers = getTiers(cy, selectedNoteId, 3);
      cy.nodes().forEach(n => { const t = tiers.get(n.id()); n.addClass(t === undefined ? 'dimmed' : `tier-${Math.min(t, 3)}`); });
      cy.edges().forEach(e => {
        const sT = tiers.get(e.source().id()), tT = tiers.get(e.target().id());
        e.addClass(sT === undefined || tT === undefined ? 'dimmed' : 'highlighted');
      });
      const sel = cy.$(`#${selectedNoteId}`);
      if (sel.length) cy.animate({ center: { eles: sel }, zoom: 1.4 }, { duration: 350 });
    }
  }, [selectedNoteId]);

  const activeCampaignName = graphCampaignRoots.find((f) => f.id === activeCampaignId)?.title;

  const rootRef = useRef(null);
  const containerWidth = useContainerWidth(rootRef);
  const campaignRef = useRef(null);
  const toolbarRef = useRef(null);
  const [isNarrowGraph, setIsNarrowGraph] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  /**
   * Mobile UX: force the graph action bar into an overflow menu.
   * On vertical mobile screens, the action set is too wide to fit without overflow.
   */
  const shouldCollapseToolbar = isMobile || isNarrowGraph;

  // Collapse toolbar to dropdown if it would overlap the campaign selector
  useEffect(() => {
    const campaign = campaignRef.current;
    const toolbar = toolbarRef.current;
    if (!campaign || !toolbar) return;
    const campaignRight = campaign.getBoundingClientRect().right;
    const toolbarLeft = toolbar.getBoundingClientRect().left;
    setIsNarrowGraph(toolbarLeft - 16 < campaignRight);
  }, [containerWidth, activeCampaignId, isDMOfActiveCampaign, is3D]);

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (tutorialRefs?.canvas) tutorialRefs.canvas.current = el;
      }}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#07080e' }}
    >
      {/* Grid background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.012) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.012) 40px)`,
      }} />

      <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 1, display: effectiveIs3D ? 'none' : 'block' }} />

      {/* Edge editor — label + direction (graph only) */}
      {editingEdge && (
        <div style={{
          position: 'absolute', zIndex: 10,
          left: Math.max(8, editingEdge.x - 160), top: editingEdge.y - 8,
          background: '#0f1219', border: '1px solid rgba(200,148,58,0.35)',
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
                flex: '1 1 140px', minWidth: '120px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(200,148,58,0.2)',
                borderRadius: '3px', color: '#e2d5bb', fontFamily: 'Crimson Pro, serif', fontSize: '14px',
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
              style={{ padding: '4px 8px', background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.3)', borderRadius: '3px', cursor: webReadOnly ? 'default' : 'pointer', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1 }}
            >
              SAVE
            </button>
            <button
              disabled={webReadOnly}
              onClick={() => handleEdgeSave(editingEdge.id, { label: '', direction: editingEdge.direction })}
              style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', cursor: webReadOnly ? 'default' : 'pointer', color: 'rgba(226,213,187,0.4)', fontFamily: 'Cinzel', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1 }}
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
                  cursor: webReadOnly ? 'default' : 'pointer', color: 'rgba(240,160,160,0.95)', fontFamily: 'Cinzel', fontSize: '9px', opacity: webReadOnly ? 0.45 : 1,
                }}
              >
                REMOVE
              </button>
            )}
          </div>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.55)', marginBottom: '5px' }}>
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
                      fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.06em',
                      background: active ? 'rgba(200,148,58,0.18)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(200,148,58,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      color: active ? '#c8943a' : 'rgba(226,213,187,0.65)',
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
              <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.15em', color: 'rgba(200,148,58,0.4)', whiteSpace: 'nowrap' }}>
                {activeCampaignName?.toUpperCase()}
              </div>
            ) : (
              <select
                ref={tutorialRefs?.campaignSelect || null}
                value={activeCampaignId || ''}
                onChange={e => setActiveCampaignId(parseInt(e.target.value))}
                style={{
                  background: 'rgba(7,8,14,0.9)', border: '1px solid rgba(200,148,58,0.3)',
                  borderRadius: '3px', color: '#c8943a', fontFamily: 'Cinzel', fontSize: '10px',
                  letterSpacing: '0.1em', padding: '5px 28px 5px 12px', cursor: 'pointer',
                  outline: 'none', appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23c8943a' opacity='0.6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
                }}
              >
                {graphCampaignRoots.map(f => (
                  <option key={f.id} value={f.id} style={{ background: '#0f1219', color: '#e2d5bb' }}>
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
                fontFamily: 'Cinzel',
                fontSize: '9px',
                letterSpacing: '0.14em',
                color: 'rgba(200,148,58,0.85)',
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
        <LegendPanel selectedNoteId={selectedNoteId} edgeTheme={edgeTheme} onEdgeThemeChange={setEdgeTheme} tutorialRefs={tutorialRefs} />
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
                style={{ fontFamily: 'Cinzel', fontSize: '11px', letterSpacing: '0.2em', padding: isMobile ? '10px 16px' : '6px 12px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', background: showToolMenu ? 'rgba(200,148,58,0.15)' : 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', color: 'rgba(200,148,58,0.6)' }}
              >{isMobile ? 'MENU' : '···'}</button>
              {showToolMenu && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 30, background: '#0f1219', border: '1px solid rgba(200,148,58,0.2)', borderRadius: '4px', padding: '5px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: isMobile ? '160px' : '140px', boxShadow: '0 6px 24px rgba(0,0,0,0.7)' }}>
                  <button onClick={() => { if (pathMode) exitPathMode(); exitTheoryMode(); exitShipMode(); is3D ? setConnectMode(v => !v) : connectMode ? exitConnectMode() : setConnectMode(true); setShowToolMenu(false); }}
                    style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: connectMode ? 'rgba(58,139,196,0.2)' : 'transparent', border: `1px solid ${connectMode ? 'rgba(58,139,196,0.4)' : 'rgba(200,148,58,0.12)'}`, color: connectMode ? 'rgba(58,196,226,0.9)' : 'rgba(200,148,58,0.7)' }}>
                    {connectMode ? '✕ Cancel Connect' : '⟵⟶ Connect'}
                  </button>
                  <button onClick={() => { exitConnectMode(); exitTheoryMode(); exitShipMode(); pathMode ? exitPathMode() : setPathMode(true); setShowToolMenu(false); }}
                    style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: pathMode ? 'rgba(139,196,58,0.18)' : 'transparent', border: `1px solid ${pathMode ? 'rgba(139,196,58,0.4)' : 'rgba(200,148,58,0.12)'}`, color: pathMode ? 'rgba(180,226,100,0.9)' : 'rgba(200,148,58,0.7)' }}>
                    {pathMode ? '✕ Cancel Path' : '⬡ Find Path'}
                  </button>
                  {!effectiveIs3D && (
                    <>
                      <button onClick={() => { if (pathMode) exitPathMode(); exitConnectMode(); exitShipMode(); theoryMode ? exitTheoryMode() : setTheoryMode(true); setShowToolMenu(false); }}
                        style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: theoryMode ? 'rgba(150,100,200,0.2)' : 'transparent', border: `1px solid ${theoryMode ? 'rgba(180,130,220,0.45)' : 'rgba(200,148,58,0.12)'}`, color: theoryMode ? 'rgba(200,170,240,0.95)' : 'rgba(200,148,58,0.7)' }}>
                        {theoryMode ? '✕ Theory' : '◇ Theory'}
                      </button>
                      <button onClick={() => { if (pathMode) exitPathMode(); exitConnectMode(); exitTheoryMode(); shipMode ? exitShipMode() : setShipMode(true); setShowToolMenu(false); }}
                        style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: shipMode ? 'rgba(220,80,140,0.18)' : 'transparent', border: `1px solid ${shipMode ? 'rgba(255,120,170,0.45)' : 'rgba(200,148,58,0.12)'}`, color: shipMode ? 'rgba(255,170,200,0.95)' : 'rgba(200,148,58,0.7)' }}>
                        {shipMode ? '✕ Ship' : '♥ Ship'}
                      </button>
                    </>
                  )}
                  <button onClick={() => { setIs3D(v => !v); exitConnectMode(); exitPathMode(); exitTheoryMode(); exitShipMode(); setShowToolMenu(false); }}
                    style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: effectiveIs3D ? 'rgba(58,139,196,0.15)' : 'transparent', border: `1px solid ${effectiveIs3D ? 'rgba(58,139,196,0.3)' : 'rgba(200,148,58,0.12)'}`, color: effectiveIs3D ? 'rgba(139,196,226,0.8)' : 'rgba(200,148,58,0.7)' }}>
                    {effectiveIs3D ? '↩ 2D View' : '◈ 3D View'}
                  </button>
                  {!effectiveIs3D && (
                    <button onClick={() => { runExpand(); setShowToolMenu(false); }}
                      style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: 'transparent', border: '1px solid rgba(200,148,58,0.12)', color: 'rgba(200,148,58,0.7)' }}>
                      ⊹ Expand
                    </button>
                  )}
                  {isDMOfActiveCampaign && (
                    <button onClick={() => { setDmView(v => !v); setShowToolMenu(false); }}
                      style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', padding: isMobile ? '11px 10px' : '7px 10px', minHeight: isMobile ? '44px' : 'auto', borderRadius: '3px', cursor: 'pointer', textAlign: 'left', background: dmView ? 'rgba(200,148,58,0.2)' : 'transparent', border: `1px solid ${dmView ? 'rgba(200,148,58,0.4)' : 'rgba(200,148,58,0.12)'}`, color: dmView ? '#c8943a' : 'rgba(200,148,58,0.7)' }}>
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
              ref={tutorialRefs?.btnConnect || null}
              onClick={() => { if (pathMode) exitPathMode(); exitTheoryMode(); exitShipMode(); if (is3D) { setConnectMode(v => !v); } else { connectMode ? exitConnectMode() : setConnectMode(true); } }}
              style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: connectMode ? 'rgba(58,139,196,0.2)' : 'rgba(200,148,58,0.08)', border: `1px solid ${connectMode ? 'rgba(58,139,196,0.5)' : 'rgba(200,148,58,0.25)'}`, color: connectMode ? 'rgba(58,196,226,0.9)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{connectMode ? '✕ Cancel' : '⟵⟶ Connect'}</button>
            <button
              ref={tutorialRefs?.btnPath || null}
              onClick={() => { exitConnectMode(); exitTheoryMode(); exitShipMode(); pathMode ? exitPathMode() : setPathMode(true); }}
              style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: pathMode ? 'rgba(139,196,58,0.18)' : 'rgba(200,148,58,0.08)', border: `1px solid ${pathMode ? 'rgba(139,196,58,0.5)' : 'rgba(200,148,58,0.25)'}`, color: pathMode ? 'rgba(180,226,100,0.9)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{pathMode ? '✕ Cancel' : '⬡ Find Path'}</button>
                  {!effectiveIs3D && (
              <>
                <button
                  ref={tutorialRefs?.btnTheory || null}
                  onClick={() => { if (pathMode) exitPathMode(); exitConnectMode(); exitShipMode(); theoryMode ? exitTheoryMode() : setTheoryMode(true); }}
                  title="Add a speculative theory link (dashed violet)"
                  style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: theoryMode ? 'rgba(150,100,200,0.2)' : 'rgba(200,148,58,0.08)', border: `1px solid ${theoryMode ? 'rgba(180,130,220,0.5)' : 'rgba(200,148,58,0.25)'}`, color: theoryMode ? 'rgba(200,170,240,0.95)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
                >{theoryMode ? '✕ Theory' : '◇ Theory'}</button>
                <button
                  ref={tutorialRefs?.btnShip || null}
                  onClick={() => { if (pathMode) exitPathMode(); exitConnectMode(); exitTheoryMode(); shipMode ? exitShipMode() : setShipMode(true); }}
                  title="Ship two NPC/Character notes (dashed pink)"
                  style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: shipMode ? 'rgba(220,80,140,0.18)' : 'rgba(200,148,58,0.08)', border: `1px solid ${shipMode ? 'rgba(255,120,170,0.5)' : 'rgba(200,148,58,0.25)'}`, color: shipMode ? 'rgba(255,170,200,0.95)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
                >{shipMode ? '✕ Ship' : '♥ Ship'}</button>
              </>
            )}
            <button
              ref={tutorialRefs?.btn3d || null}
              onClick={() => { setIs3D(v => !v); exitConnectMode(); exitPathMode(); exitTheoryMode(); exitShipMode(); }}
              style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: effectiveIs3D ? 'rgba(58,139,196,0.15)' : 'rgba(200,148,58,0.08)', border: `1px solid ${effectiveIs3D ? 'rgba(58,139,196,0.4)' : 'rgba(200,148,58,0.25)'}`, color: effectiveIs3D ? 'rgba(139,196,226,0.8)' : 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
            >{effectiveIs3D ? '2D' : '3D'}</button>
            {!effectiveIs3D && (
              <button ref={tutorialRefs?.btnExpand || null} onClick={runExpand} title="Auto-arrange all nodes to remove overlaps"
                style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: 'rgba(200,148,58,0.08)', border: '1px solid rgba(200,148,58,0.25)', color: 'rgba(200,148,58,0.6)', whiteSpace: 'nowrap' }}
              >⊹ Expand</button>
            )}
            {isDMOfActiveCampaign && (
              <button ref={tutorialRefs?.btnDmView || null} onClick={() => setDmView(v => !v)} title={dmView ? 'Showing DM-only notes — click to hide' : 'Show DM-only notes'}
                style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.12em', padding: '6px 14px', borderRadius: '3px', cursor: 'pointer', background: dmView ? 'rgba(200,148,58,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${dmView ? 'rgba(200,148,58,0.5)' : 'rgba(255,255,255,0.1)'}`, color: dmView ? '#c8943a' : 'rgba(226,213,187,0.3)', whiteSpace: 'nowrap' }}
              >⚔ DM View</button>
            )}
          </div>
        </div>

        {/* Status / hints — below the button row */}
        {(connectMode || theoryMode || shipMode || pathMode || pathResult) && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(connectMode || theoryMode || shipMode) && !pathMode && (
              <div style={{
                fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px',
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
              <div style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(139,196,58,0.12)', border: '1px solid rgba(139,196,58,0.35)', borderRadius: '3px', color: 'rgba(180,226,100,0.9)', whiteSpace: 'nowrap' }}>
                {pathSource ? `FROM: ${(pathSource.title || pathSource.name || '').slice(0, 20)} → click target` : 'Click source node'}
              </div>
            )}
            {pathResult && !pathResult.found && (
              <div style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(196,80,58,0.12)', border: '1px solid rgba(196,80,58,0.35)', borderRadius: '3px', color: 'rgba(226,140,100,0.9)', whiteSpace: 'nowrap' }}>
                No path found between these nodes
              </div>
            )}
            {pathResult?.found && (
              <div style={{ fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.12em', padding: '6px 12px', background: 'rgba(139,196,58,0.12)', border: '1px solid rgba(139,196,58,0.35)', borderRadius: '3px', color: 'rgba(180,226,100,0.9)', whiteSpace: 'nowrap' }}>
                {pathResult.paths.length} path{pathResult.paths.length > 1 ? 's' : ''} · {pathResult.paths[0].length - 1} hops
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3D graph overlay */}
      {effectiveIs3D && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
          <GraphView3D
            notes={visibleNotes}
            connections={visibleConnections}
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

      {visibleNotes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', opacity: 0.25 }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '18px', color: '#c8943a', marginBottom: '8px' }}>No notes in this campaign</div>
            <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: '#e2d5bb' }}>Create notes and they'll appear here</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Wires Cytoscape: normal select/open, connect/theory/ship two-tap links, path finder, edge label edit, background clear, hover tier preview.
 * Theory/ship edges skip orange tier styling and use dim/highlight only.
 */
function bindEvents(cy, onSelectNote, onOpenNote, hoverTimerRef, connectModeRef, connectSourceRef, setConnectSource, finishActiveLinkMode, onCreateConnection, editingEdgeRef, setEditingEdge, pathModeRef, pathSourceRef, setPathSource, setPathResult, exitPathMode, theoryModeRef, shipModeRef) {
  const lastClickRef = { id: null, time: 0 };
  const TIER_CLASSES = ['tier-0','tier-1','tier-2','tier-3','tier-4','tier-5','tier-6'];
  const ALL_CLASSES  = [...TIER_CLASSES, 'dimmed', 'highlighted', 'path-node', 'path-edge', 'path-floor', 'path-pick-dim', 'connect-source', 'connect-dim', 'theory-source', 'ship-source'].join(' ');

  cy.on('tap', 'node', (e) => {
    // Connect / theory / ship (shared two-tap flow)
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

    // Path finder mode
    if (pathModeRef.current) {
      const id    = e.target.id();
      const title = e.target.data('label');
      if (!pathSourceRef.current) {
        setPathSource({ id, title });
        // Highlight source node immediately
        cy.elements().removeClass(ALL_CLASSES);
        cy.getElementById(id).addClass('tier-0');
        cy.nodes().not(`#${id}`).addClass('path-pick-dim');
        cy.edges().addClass('path-pick-dim');
      } else {
        const srcId = pathSourceRef.current.id;
        if (srcId === id) return; // same node — ignore
        const paths = getAllShortestPaths(cy, srcId, id, 3);
        cy.elements().removeClass(ALL_CLASSES);
        if (paths.length === 0) {
          setPathResult({ found: false, paths: [] });
          // Show both chosen nodes, floor everything else
          cy.getElementById(srcId).addClass('tier-0');
          cy.getElementById(id).addClass('tier-0');
          cy.nodes().not(`#${srcId}`).not(`#${id}`).addClass('path-floor');
        } else {
          setPathResult({ found: true, paths });
          // Collect all node ids and edges on any path
          const pathNodeIds = new Set();
          const pathEdgePairs = new Set(); // "minId_maxId" for each hop
          paths.forEach(path => {
            path.forEach(nid => pathNodeIds.add(nid));
            for (let i = 0; i < path.length - 1; i++) {
              const a = path[i], b = path[i + 1];
              pathEdgePairs.add([a, b].sort().join('_'));
            }
          });
          // Apply path-node class + floor everything else
          cy.nodes().forEach(n => {
            if (pathNodeIds.has(n.id())) n.addClass('path-node');
            else n.addClass('path-floor');
          });
          // Apply path-edge or floor to edges
          cy.edges().forEach(edge => {
            const pair = [edge.source().id(), edge.target().id()].sort().join('_');
            if (pathEdgePairs.has(pair)) edge.addClass('path-edge');
            else edge.addClass('path-floor');
          });
        }
      }
      return;
    }

    // Normal click — single/double detection
    const now = Date.now();
    const id = e.target.id();
    if (id === lastClickRef.id && now - lastClickRef.time < 350) {
      onOpenNote(parseInt(id));
      lastClickRef.id = null;
    } else {
      lastClickRef.id = id;
      lastClickRef.time = now;
      onSelectNote(parseInt(id));
    }
  });

  cy.on('tap', (e) => {
    if (e.target === cy) {
      cy.elements().removeClass(ALL_CLASSES);
      if (editingEdgeRef.current) setEditingEdge(null);
      if (connectModeRef.current || theoryModeRef.current || shipModeRef.current) setConnectSource(null);
    }
  });

  // Edge click → open label + direction editor
  cy.on('tap', 'edge', (e) => {
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
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
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
      const id = e.target.id();
      cy.elements().removeClass(ALL_CLASSES);
      const tiers = getTiers(cy, id, MAX_HOPS);
      cy.nodes().forEach(n => {
        const t = tiers.get(n.id());
        n.addClass(t === undefined ? 'dimmed' : `tier-${Math.min(t, MAX_HOPS)}`);
      });
      cy.edges().forEach(edge => {
        if (edge.hasClass('kind-theory') || edge.hasClass('kind-ship')) {
          const sT = tiers.get(edge.source().id()) ?? Infinity;
          const tT = tiers.get(edge.target().id()) ?? Infinity;
          if (sT === Infinity || tT === Infinity) edge.addClass('dimmed');
          else edge.addClass('highlighted');
          return;
        }
        const sT = tiers.get(edge.source().id()) ?? Infinity;
        const tT = tiers.get(edge.target().id()) ?? Infinity;
        if (sT === Infinity || tT === Infinity) edge.addClass('dimmed');
        else edge.addClass(`tier-${Math.min(Math.max(sT, tT), MAX_HOPS)}`);
      });
    }, 200);
  });

  cy.on('mouseout', 'node', () => {
    if (connectModeRef.current || pathModeRef.current || theoryModeRef.current || shipModeRef.current) return;
    clearTimeout(hoverTimerRef.current);
    cy.elements().removeClass(ALL_CLASSES);
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
        a.position({ x: pa.x - pushX, y: pa.y - pushY });
        b.position({ x: pb.x + pushX, y: pb.y + pushY });
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
          'arrow-scale': 1.3,
        },
      },
      {
        selector: `edge.kind-${key}.dir-reverse`,
        style: {
          'source-arrow-shape': 'triangle',
          'source-arrow-color': t.color,
          'source-arrow-opacity': arrowOp,
          'arrow-scale': 1.3,
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
function applyGraphStyle(cy, theme) {
  if (!cy) return;
  cy.style().fromJson(buildStyle(theme));
  cy.style().update();
}

/**
 * Returns a Cytoscape edge class for connection_kind (canon / theory / ship).
 * Legacy rows use is_speculative → theory; unknown values default to canon.
 */
function connectionKindClass(conn) {
  const k = conn.connection_kind;
  if (k === 'theory' || k === 'ship') return `kind-${k}`;
  if (k === 'canon') return 'kind-canon';
  if (conn.is_speculative) return 'kind-theory';
  return 'kind-canon';
}

/**
 * Stable fingerprint of visible graph data — ignores parent re-render array identity.
 * @param {object[]} notes
 * @param {object[]} connections
 * @returns {string}
 */
function buildGraphFingerprint(notes, connections) {
  return notes.map(n => `${n.id}:${n.title}:${n.category}`)
    .concat(connections.map(c => `${c.id}:${c.source_note_id}-${c.target_note_id}:${c.label || ''}:${c.connection_kind || ''}:${c.direction || 'bidirectional'}:${c.is_speculative ? 1 : 0}`))
    .join('|');
}

function buildElements(notes, connections) {
  const nodeIds = new Set(notes.map(n => String(n.id)));
  return [
    ...notes.map(note => ({
      data: { id: String(note.id), label: note.title, category: note.category, color: getCategoryColor(note.category) },
    })),
    ...connections
      .filter(conn => nodeIds.has(String(conn.source_note_id)) && nodeIds.has(String(conn.target_note_id)))
      .map(conn => ({
        data: {
          id: `e${conn.id}`,
          connId: conn.id,
          source: String(conn.source_note_id),
          target: String(conn.target_note_id),
          label: conn.label || '',
          direction: conn.direction || 'bidirectional',
        },
        classes: `${connectionKindClass(conn)} ${connectionDirectionClass(conn)}`,
      })),
  ];
}

function buildStyle(edgeTheme = DEFAULT_EDGE_THEME) {
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
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)', 'background-opacity': 0.15,
        'border-color': 'data(color)', 'border-width': 1.5, 'border-opacity': 0.8,
        'label': 'data(label)', 'color': '#e2d5bb', 'font-family': 'Cinzel, serif', 'font-size': '11px',
        'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 6,
        'text-background-color': '#07080e', 'text-background-opacity': 0.75, 'text-background-padding': '3px',
        'text-wrap': 'ellipsis', 'text-max-width': '120px',
        'width': 34, 'height': 34,
        'transition-property': 'opacity, width, height, border-width, background-opacity', 'transition-duration': '200ms',
      },
    },
    ...nodeTierStyles,
    { selector: 'node.dimmed',     style: { 'opacity': FLOOR_OPACITY } },
    { selector: 'node.path-pick-dim', style: { 'opacity': PATH_FIND_PICK_DIM_OPACITY } },
    { selector: 'edge.path-pick-dim', style: { 'opacity': PATH_FIND_PICK_DIM_OPACITY } },
    { selector: 'node.path-node',  style: { 'opacity': 1, 'background-opacity': 0.7, 'border-width': 3, 'border-opacity': 1, 'width': 44, 'height': 44 } },
    { selector: 'node.path-floor', style: { 'opacity': FLOOR_OPACITY } },
    {
      selector: 'edge',
      style: {
        'width': 2, 'line-color': canon.color, 'line-opacity': canonB, 'curve-style': 'bezier',
        'label': 'data(label)', 'font-size': '9px', 'color': canon.color,
        'text-opacity': Math.min(1, canonB * 1.1),
        'font-family': 'Cinzel, serif', 'text-background-color': '#07080e',
        'text-background-opacity': 0.7, 'text-background-padding': '2px',
        'transition-property': 'opacity, line-color, line-opacity, width', 'transition-duration': '200ms',
      },
    },
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

/** Preset swatches for the in-app edge color picker (no native OS dialog). */
const EDGE_COLOR_PRESETS = [
  '#c8943a', '#d4a84a', '#e2d5bb',
  '#9664c8', '#7a50a8',
  '#d05090', '#c07088',
  '#6a9cb8', '#7ab87a', '#a08060',
];

/**
 * In-app color picker: preset swatches + hex field (Chronicler styling).
 * @param {{ value: string, onChange: (hex: string) => void, label: string }} props
 */
function ChroniclerColorPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const wrapRef = useRef(null);

  useEffect(() => { setHexDraft(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const commitHex = () => {
    const v = hexDraft.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
    else setHexDraft(value);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`${label} color`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 32, height: 26, padding: 2, borderRadius: 4, cursor: 'pointer',
          background: '#07080e', border: `1px solid ${open ? 'rgba(200,148,58,0.55)' : 'rgba(200,148,58,0.35)'}`,
        }}
      >
        <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: 2, background: value }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 50,
            background: '#0f1219', border: '1px solid rgba(200,148,58,0.35)',
            borderRadius: 6, padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.8)', width: 156,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.65)', marginBottom: 8 }}>
            {label.toUpperCase()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 10 }}>
            {EDGE_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set color ${c}`}
                onClick={() => { onChange(c); setOpen(false); }}
                style={{
                  width: 24, height: 24, borderRadius: 3, padding: 0, cursor: 'pointer',
                  background: c,
                  border: c.toLowerCase() === value.toLowerCase() ? '2px solid #e2d5bb' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: c.toLowerCase() === value.toLowerCase() ? '0 0 6px rgba(200,148,58,0.4)' : 'none',
                }}
              />
            ))}
          </div>
          <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.14em', color: 'rgba(200,148,58,0.55)', marginBottom: 4 }}>HEX</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitHex(); setOpen(false); } }}
              onBlur={commitHex}
              style={{
                flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 3,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(200,148,58,0.25)',
                color: '#e2d5bb', fontFamily: 'monospace', fontSize: 11, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => { commitHex(); setOpen(false); }}
              style={{
                padding: '4px 7px', borderRadius: 3, cursor: 'pointer', fontFamily: 'Cinzel', fontSize: '8px',
                background: 'rgba(200,148,58,0.15)', border: '1px solid rgba(200,148,58,0.3)', color: '#c8943a',
              }}
            >
              SET
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Brightness slider styled for the graph legend panel.
 * @param {{ value: number, onChange: (n: number) => void, accentColor: string, label: string }} props
 */
function ChroniclerBrightnessSlider({ value, onChange, accentColor, label }) {
  const pct = Math.round(value * 100);
  return (
    <input
      type="range"
      min={5}
      max={100}
      value={pct}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      style={{
        flex: 1,
        minWidth: 0,
        height: 20,
        margin: 0,
        cursor: 'pointer',
        accentColor: accentColor || '#c8943a',
      }}
    />
  );
}

function LegendPanel({ selectedNoteId, edgeTheme, onEdgeThemeChange, tutorialRefs = null }) {
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
          <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>CATEGORIES</div>
          {[
            { cat: 'npc', label: 'NPC' }, { cat: 'location', label: 'Location' },
            { cat: 'faction', label: 'Faction' }, { cat: 'item', label: 'Item' },
            { cat: 'event', label: 'Event' }, { cat: 'lore', label: 'Lore' },
            { cat: 'general', label: 'General' },
          ].map(({ cat, label }) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: getCategoryColor(cat), flexShrink: 0 }} />
              <span style={{ fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.75)', letterSpacing: '0.05em' }}>{label}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px', opacity: selectedNoteId ? 1 : 0.35, transition: 'opacity 0.2s' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', margin: '8px 0' }}>CONNECTION DEPTH</div>
            {[{ label: 'Selected', opacity: 1 }, { label: '1 hop', opacity: 0.75 }, { label: '2 hops', opacity: 0.45 }, { label: '3+ hops', opacity: 0.2 }].map(({ label, opacity }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: `rgba(200,148,58,${opacity})`, flexShrink: 0 }} />
                <span style={{ fontFamily: 'Cinzel', fontSize: '9px', color: `rgba(226,213,187,${Math.min(1, opacity * 0.8 + 0.4)})`, letterSpacing: '0.05em' }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>CONNECTIONS</div>
            {EDGE_KIND_META.map(({ key, label }) => {
              const t = edgeTheme?.[key] || DEFAULT_EDGE_THEME[key];
              const dash = key !== 'canon';
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ width: '22px', flexShrink: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${t.color}`, opacity: t.brightness }} />
                  <span style={{ fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.75)', letterSpacing: '0.05em' }}>{label}</span>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>DIRECTION</div>
            {[
              { label: 'Both ways', glyph: '—' },
              { label: 'One way', glyph: '→' },
            ].map(({ label, glyph }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontFamily: 'Cinzel', fontSize: '11px', color: 'rgba(200,148,58,0.55)', width: '22px', flexShrink: 0, textAlign: 'center' }}>{glyph}</span>
                <span style={{ fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.75)', letterSpacing: '0.05em' }}>{label}</span>
              </div>
            ))}
          </div>
          {onEdgeThemeChange && edgeTheme && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '10px 0 8px' }}>
              <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.7)', marginBottom: '8px' }}>EDGE APPEARANCE</div>
              <div style={{ fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.08em', color: 'rgba(200,148,58,0.45)', marginBottom: '8px', lineHeight: 1.4 }}>
                Color and brightness per link type (line, label, arrows)
              </div>
              {EDGE_KIND_META.map(({ key, label }) => (
                <div key={key} style={{ marginBottom: '12px' }}>
                  <div style={{ fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.75)', marginBottom: '5px', letterSpacing: '0.06em' }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ChroniclerColorPicker
                      label={label}
                      value={edgeTheme[key].color}
                      onChange={(color) => onEdgeThemeChange((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], color },
                      }))}
                    />
                    <ChroniclerBrightnessSlider
                      label={`${label} edge brightness`}
                      accentColor={edgeTheme[key].color}
                      value={edgeTheme[key].brightness}
                      onChange={(brightness) => onEdgeThemeChange((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], brightness },
                      }))}
                    />
                    <span style={{ fontFamily: 'Cinzel', fontSize: '8px', color: 'rgba(200,148,58,0.55)', width: 30, textAlign: 'right', flexShrink: 0 }}>
                      {Math.round(edgeTheme[key].brightness * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '8px', fontFamily: 'Cinzel', fontSize: '7px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.55)' }}>
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
        <span style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.05em', writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', color: 'rgba(200,148,58,0.65)' }}>LEGEND</span>
        <span style={{ fontSize: '10px', marginTop: '4px' }}>{open ? '«' : '»'}</span>
      </button>
    </div>
  );
}
