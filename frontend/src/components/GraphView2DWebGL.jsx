import { useEffect, useRef, memo } from 'react';
import { SigmaRenderer } from '../graph/renderers/SigmaRenderer.js';
import { buildGraphFingerprint } from '../graph/elements.js';
import { loadGraphPositions, saveGraphPositions } from '../graph/storage.js';
import { paintZoomHud } from '../graph/paintZoomHud.js';
import { zoomPerformanceZone } from '../graph/lod.js';
import {
  buildCanonAdjacency,
  getTiersFromAdj,
  getAllShortestPaths,
} from '../graph/adjacency.js';

/**
 * Maps undirected node pairs to sigma edge keys for path highlighting.
 * @param {object[]} connections
 * @returns {Map<string, string>}
 */
function buildEdgePairMap(connections) {
  const map = new Map();
  connections.forEach((c) => {
    const a = String(c.source_note_id);
    const b = String(c.target_note_id);
    map.set(`${a}|${b}`, `e${c.id}`);
    map.set(`${b}|${a}`, `e${c.id}`);
  });
  return map;
}

/**
 * Production WebGL 2D graph canvas (sigma.js) with parity to the Cytoscape map.
 * @param {object} props
 */
function GraphView2DWebGL({
  notes,
  connections,
  posKey,
  edgeTheme,
  selectedNoteId,
  onSelectNote,
  onOpenNote,
  onCreateConnection,
  onEdgeClick,
  onAcknowledgeNewNode,
  onDragEnd,
  connectMode,
  theoryMode,
  shipMode,
  pathMode,
  connectSource,
  pathSource,
  pathResult,
  onConnectSourceSet,
  onPathSourceSet,
  onPathResult,
  highlightNewActive,
  newHighlightIds,
  manualNodeIds,
  organizePreview,
  onRunOrganize,
  zoomHudRef,
  showZoomHudRef,
  paintZoomHudRef,
  pushZoomHudLiveRef,
  rendererRef,
}) {
  const containerRef = useRef(null);
  const rendererRefInternal = useRef(null);
  const fingerprintRef = useRef('');
  const fpsFramesRef = useRef(0);
  const fpsIntervalRef = useRef(null);
  const canonAdjRef = useRef(new Map());
  const organizeRanRef = useRef(false);
  /** Fresh handler props for sigma listeners (mount effect does not rebind). */
  const handlersRef = useRef({});

  handlersRef.current = {
    notes,
    connections,
    connectSource,
    pathSource,
    theoryMode,
    shipMode,
    onSelectNote,
    onOpenNote,
    onCreateConnection,
    onConnectSourceSet,
    onPathSourceSet,
    onPathResult,
    onEdgeClick,
    onAcknowledgeNewNode,
    onDragEnd,
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const renderer = new SigmaRenderer();
    rendererRefInternal.current = renderer;
    if (rendererRef) rendererRef.current = renderer;
    renderer.mount(el);

    const positions = loadGraphPositions(posKey) || {};
    renderer.setGraph(notes, connections, positions, edgeTheme);
    fingerprintRef.current = buildGraphFingerprint(notes, connections);
    canonAdjRef.current = buildCanonAdjacency(connections);
    renderer.setVisualState({ manualNodeIds });

    const pushHud = () => {
      if (!showZoomHudRef.current) return;
      const z = renderer.getZoom();
      const h = handlersRef.current;
      paintZoomHud(zoomHudRef.current, {
        zoom: z,
        nodes: h.notes.length,
        edges: h.connections.length,
        engine: 'performance (WebGL)',
        visibleInView: renderer.countNodesInViewport(),
      });
      pushZoomHudLiveRef.current?.({
        zoom: z,
        zone: zoomPerformanceZone(z),
        nodes: h.notes.length,
        edges: h.connections.length,
      });
    };

    paintZoomHudRef.current = pushHud;
    pushHud();

    renderer.on('clickNode', (nodeId) => {
      handlersRef.current.onSelectNote?.(parseInt(nodeId, 10));
    });
    renderer.on('doubleClickNode', (nodeId) => {
      handlersRef.current.onOpenNote?.(parseInt(nodeId, 10));
    });

    renderer.on('linkNodeTap', (nodeId) => {
      const h = handlersRef.current;
      const note = h.notes.find((n) => String(n.id) === nodeId);
      if (!note) return;
      if (!h.connectSource) {
        h.onConnectSourceSet?.(note);
        renderer.setVisualState({
          linkMode: h.theoryMode ? 'theory' : h.shipMode ? 'ship' : 'connect',
          linkSourceId: nodeId,
          linkDimOthers: true,
        });
        return;
      }
      if (String(h.connectSource.id) === nodeId) return;
      const kind = h.theoryMode ? 'theory' : h.shipMode ? 'ship' : 'canon';
      h.onCreateConnection?.(h.connectSource.id, parseInt(nodeId, 10), { connection_kind: kind });
      renderer.clearVisualOverlays();
      h.onConnectSourceSet?.(null);
    });

    renderer.on('pathNodeTap', (nodeId) => {
      const h = handlersRef.current;
      const note = h.notes.find((n) => String(n.id) === nodeId);
      if (!note) return;
      if (!h.pathSource) {
        h.onPathSourceSet?.(note);
        renderer.setVisualState({ pathPickDim: true, pathSourceId: nodeId, pathActive: true });
        return;
      }
      if (String(h.pathSource.id) === nodeId) return;
      const paths = getAllShortestPaths(canonAdjRef.current, String(h.pathSource.id), nodeId, 3);
      if (paths.length === 0) {
        h.onPathResult?.({ found: false, paths: [] });
        renderer.setVisualState({ pathPickDim: false, pathSourceId: null, pathActive: true });
        return;
      }
      const nodeIds = new Set();
      const edgeIds = new Set();
      const edgeMap = buildEdgePairMap(h.connections);
      paths.forEach((path) => {
        path.forEach((nid) => nodeIds.add(nid));
        for (let i = 0; i < path.length - 1; i += 1) {
          const key = edgeMap.get(`${path[i]}|${path[i + 1]}`);
          if (key) edgeIds.add(key);
        }
      });
      renderer.setPathHighlight(nodeIds, edgeIds);
      h.onPathResult?.({ found: true, paths });
    });

    renderer.on('clickEdge', (payload) => handlersRef.current.onEdgeClick?.(payload));
    renderer.on('clickBackground', () => {
      const h = handlersRef.current;
      renderer.clearVisualOverlays();
      h.onConnectSourceSet?.(null);
      h.onPathSourceSet?.(null);
      h.onPathResult?.(null);
    });
    renderer.on('acknowledgeNewNode', (nodeId) => handlersRef.current.onAcknowledgeNewNode?.(nodeId));
    renderer.on('dragEnd', (nodeId) => handlersRef.current.onDragEnd?.(nodeId));

    renderer.on('viewport', () => {
      clearTimeout(rendererRefInternal.current._hudTimer);
      rendererRefInternal.current._hudTimer = setTimeout(pushHud, 120);
    });
    renderer.on('render', () => { fpsFramesRef.current += 1; });

    fpsIntervalRef.current = setInterval(() => {
      if (!showZoomHudRef.current) return;
      const fpsEl = zoomHudRef.current?.querySelector('[data-fps]');
      if (fpsEl) fpsEl.textContent = `${fpsFramesRef.current} FPS`;
      fpsFramesRef.current = 0;
    }, 1000);

    return () => {
      clearTimeout(rendererRefInternal.current?._hudTimer);
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
      const pos = renderer.getPositions();
      saveGraphPositions(posKey, pos);
      renderer.destroy();
      rendererRefInternal.current = null;
      if (rendererRef) rendererRef.current = null;
      paintZoomHudRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    const fp = buildGraphFingerprint(notes, connections);
    if (fp === fingerprintRef.current) return;
    fingerprintRef.current = fp;
    canonAdjRef.current = buildCanonAdjacency(connections);
    const positions = loadGraphPositions(posKey) || renderer.getPositions();
    renderer.setGraph(notes, connections, positions, edgeTheme);
    renderer.setVisualState({ manualNodeIds });
    paintZoomHudRef.current?.();
  }, [notes, connections, edgeTheme, posKey, manualNodeIds]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    renderer.setEdgeTheme(edgeTheme);
  }, [edgeTheme]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    renderer.setSelected(selectedNoteId);
    if (selectedNoteId) {
      if (!pathResult) {
        const tiers = getTiersFromAdj(canonAdjRef.current, selectedNoteId, 3);
        renderer.setTierHighlight(tiers, 3);
      }
      renderer.centerOn(selectedNoteId, 1.4);
    } else if (!pathMode && !pathResult) {
      renderer.clearVisualOverlays();
    }
    paintZoomHudRef.current?.();
  }, [selectedNoteId, pathResult, pathMode]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    if (!connectMode && !theoryMode && !shipMode) {
      renderer.setVisualState({ linkMode: null, linkSourceId: null, linkDimOthers: false });
    } else if (connectSource) {
      renderer.setVisualState({
        linkMode: theoryMode ? 'theory' : shipMode ? 'ship' : 'connect',
        linkSourceId: String(connectSource.id),
        linkDimOthers: true,
      });
    } else {
      renderer.setVisualState({
        linkMode: theoryMode ? 'theory' : shipMode ? 'ship' : 'connect',
        linkSourceId: null,
        linkDimOthers: false,
      });
    }
  }, [connectMode, theoryMode, shipMode, connectSource]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    if (!pathMode) {
      renderer.setVisualState({ pathPickDim: false, pathSourceId: null, pathActive: false });
      if (!pathResult && !selectedNoteId) renderer.clearVisualOverlays();
    } else {
      renderer.setVisualState({
        pathActive: true,
        pathPickDim: !!pathSource,
        pathSourceId: pathSource ? String(pathSource.id) : null,
      });
    }
  }, [pathMode, pathSource, pathResult, selectedNoteId]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    if (highlightNewActive && newHighlightIds?.size) {
      renderer.setNewHighlights(newHighlightIds, true);
    } else {
      renderer.clearNewHighlights();
    }
  }, [highlightNewActive, newHighlightIds]);

  useEffect(() => {
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    renderer.setVisualState({ manualNodeIds });
  }, [manualNodeIds]);

  useEffect(() => {
    if (!organizePreview) {
      organizeRanRef.current = false;
      return;
    }
    if (organizeRanRef.current) return;
    const renderer = rendererRefInternal.current;
    if (!renderer) return;
    organizeRanRef.current = true;
    onRunOrganize?.(renderer);
  }, [organizePreview, onRunOrganize]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, zIndex: 1 }}
    />
  );
}

export default memo(GraphView2DWebGL);
