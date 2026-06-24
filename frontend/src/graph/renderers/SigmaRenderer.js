import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeLineProgram } from 'sigma/rendering';
import { buildGraphModel } from '../elements.js';
import { DEFAULT_EDGE_THEME } from '../connections.js';
import { GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM, EDGE_LABEL_MIN_ZOOM } from '../constants.js';
import { computeGraphLod } from '../lod.js';
import {
  nodeOpacityFromState,
  edgeStyleFromState,
  linkSourceBorder,
  newHighlightStyle,
  graphToScreen,
} from '../sigmaVisual.js';
import { runForceLayout2d } from '../forceLayout2d.js';

const NODE_SIZE = 15;

/**
 * Assigns grid positions to nodes that lack saved coordinates.
 * @param {object[]} nodes
 * @param {Record<string, { x: number, y: number }>} positions
 * @returns {Record<string, { x: number, y: number }>}
 */
function ensurePositions(nodes, positions) {
  const out = { ...positions };
  const cols = Math.ceil(Math.sqrt(nodes.length || 1));
  const spacing = 140;
  nodes.forEach((n, i) => {
    if (out[n.id]) return;
    const row = Math.floor(i / cols);
    const col = i % cols;
    out[n.id] = { x: col * spacing, y: row * spacing };
  });
  return out;
}

/**
 * Creates empty visual overlay state for tier/path/link/highlight modes.
 * @returns {object}
 */
function createVisualState() {
  return {
    tierMap: null,
    pathNodeIds: null,
    pathEdgeIds: null,
    pathFloor: false,
    pathPickDim: false,
    pathSourceId: null,
    pathActive: false,
    linkMode: null,
    linkSourceId: null,
    linkDimOthers: false,
    highlightNewMode: false,
    newHighlightIds: new Set(),
    newHighlightFlash: false,
    manualNodeIds: new Set(),
    organizePreview: false,
    lockedNodeIds: new Set(),
  };
}

/**
 * WebGL graph renderer (sigma.js) with feature parity to the Cytoscape map.
 */
export class SigmaRenderer {
  constructor() {
    /** @type {Sigma|null} */
    this.sigma = null;
    /** @type {Graph|null} */
    this.graph = null;
    /** @type {HTMLElement|null} */
    this.container = null;
    /** @type {typeof DEFAULT_EDGE_THEME} */
    this.edgeTheme = { ...DEFAULT_EDGE_THEME };
    /** @type {Record<string, Function>} */
    this.handlers = {};
    this.lastClick = { id: null, time: 0 };
    this.selectedNodeId = null;
    this.lod = { hideNodeLabels: false, hideEdgeLabels: false };
    this.visualState = createVisualState();
    /** @type {object[]} */
    this.notes = [];
    /** @type {object[]} */
    this.connections = [];
    /** @type {Record<string, object>} */
    this.edgeMeta = {};
    this.draggedNode = null;
    this.paused = false;
    this.flashTimer = null;
    this.organizeSnapshot = null;
  }

  /**
   * @param {HTMLElement} container
   */
  mount(container) {
    this.container = container;
    this.bindVisibilityPause();
  }

  /** Pauses WebGL rendering when the tab is hidden to save GPU. */
  bindVisibilityPause() {
    if (typeof document === 'undefined') return;
    this._onVisibility = () => {
      this.paused = document.hidden;
      if (!this.paused) this.sigma?.refresh();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /** Tears down sigma and releases WebGL resources. */
  destroy() {
    if (typeof document !== 'undefined' && this._onVisibility) {
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    if (this.flashTimer) clearInterval(this.flashTimer);
    if (this.sigma) this.sigma.kill();
    this.sigma = null;
    this.graph = null;
  }

  /**
   * Builds or rebuilds the graph from campaign notes and connections.
   * @param {object[]} notes
   * @param {object[]} connections
   * @param {Record<string, { x: number, y: number }>|null} positions
   * @param {import('../../theme/schema.js').ChroniclerTheme|typeof DEFAULT_EDGE_THEME} [theme]
   */
  setGraph(notes, connections, positions = {}, theme = DEFAULT_EDGE_THEME) {
    if (!this.container) return;
    const edgeTheme = theme?.edges || theme;
    const labelColor = theme?.colors?.textPrimary || '#e2d5bb';
    const graphBg = theme?.colors?.graphBg || theme?.colors?.shellBg || '#07080e';
    const displayFont = theme?.fonts?.display || 'Cinzel';
    const savedVisual = { ...this.visualState, newHighlightIds: new Set(this.visualState.newHighlightIds) };
    const savedSelected = this.selectedNodeId;
    this.destroy();
    this.mount(this.container);
    this.visualState = savedVisual;
    this.selectedNodeId = savedSelected;
    this.edgeTheme = edgeTheme;
    this.siteTheme = theme;
    this.notes = notes;
    this.connections = connections;

    const pos = ensurePositions(
      notes.map((n) => ({ id: String(n.id) })),
      positions || {},
    );
    const model = buildGraphModel(notes, connections, pos);
    const graph = new Graph({ multi: false, type: 'undirected' });
    this.edgeMeta = {};

    for (const n of model.nodes) {
      graph.addNode(n.id, {
        label: n.label,
        x: n.x,
        y: n.y,
        size: NODE_SIZE,
        color: n.color,
        baseColor: n.color,
      });
    }
    for (const e of model.edges) {
      if (graph.hasEdge(e.source, e.target)) continue;
      this.edgeMeta[e.id] = e;
      graph.addEdgeWithKey(e.id, e.source, e.target, {
        size: 1.5,
        kind: e.kind,
        direction: e.direction,
        label: e.label,
        connId: e.connId,
      });
    }

    this.graph = graph;
    this.sigma = new Sigma(graph, this.container, {
      renderLabels: true,
      renderEdgeLabels: true,
      labelDensity: 0.35,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 4,
      labelSize: 11,
      labelFont: `${displayFont}, serif`,
      labelColor: { color: labelColor },
      defaultNodeColor: '#c8943a',
      defaultEdgeColor: '#c8943a',
      backgroundColor: graphBg,
      itemSizesReference: 'screen',
      minCameraRatio: GRAPH_MIN_ZOOM,
      maxCameraRatio: GRAPH_MAX_ZOOM,
      enableEdgeEvents: true,
      edgeProgramClasses: {
        arrow: EdgeArrowProgram,
        line: EdgeLineProgram,
      },
      nodeReducer: (id, data) => this.reduceNode(id, data),
      edgeReducer: (id, data) => this.reduceEdge(id, data),
    });

    this.bindEvents();
    this.sigma.getCamera().animatedReset({ duration: 0 });
    this.applyLod();
  }

  /**
   * @param {string} id
   * @param {object} data
   */
  reduceNode(id, data) {
    const next = { ...data };
    const opacity = nodeOpacityFromState(id, this.visualState);
    next.color = data.baseColor || data.color;
    if (opacity < 1) next.color = next.color;

    if (this.selectedNodeId === id) {
      next.highlighted = true;
      next.size = NODE_SIZE * 1.25;
      next.forceLabel = true;
      next.zIndex = 2;
    }

    const linkBorder = linkSourceBorder(id, this.visualState);
    if (linkBorder) {
      next.borderColor = linkBorder;
      next.borderSize = 3;
      next.forceLabel = true;
    }

    const nh = newHighlightStyle(id, this.visualState);
    if (nh) {
      next.borderColor = nh.borderColor;
      next.borderSize = nh.borderSize;
      next.forceLabel = true;
    }

    if (opacity < 1) {
      next.label = this.lod.hideNodeLabels ? '' : data.label;
    }
    if (this.lod.hideNodeLabels && this.selectedNodeId !== id && !nh && !linkBorder) {
      next.label = '';
    }

    return next;
  }

  /**
   * @param {string} id
   * @param {object} data
   */
  reduceEdge(id, data) {
    const meta = this.edgeMeta[id] || data;
    const styled = edgeStyleFromState(
      { ...meta, id, source: this.graph?.source(id), target: this.graph?.target(id) },
      this.edgeTheme,
      this.visualState,
    );
    return {
      ...data,
      color: styled.color,
      size: styled.size,
      label: this.lod.hideEdgeLabels ? '' : styled.label,
      type: styled.type,
      opacity: styled.opacity,
    };
  }

  /** Wires sigma pointer, drag, and camera events. */
  bindEvents() {
    if (!this.sigma) return;
    const graph = this.graph;

    this.sigma.on('clickNode', ({ node, event }) => {
      if (this.visualState.highlightNewMode) {
        if (this.visualState.newHighlightIds.has(node)) {
          this.handlers.acknowledgeNewNode?.(node);
        }
        return;
      }
      if (this.visualState.pathActive) {
        this.handlers.pathNodeTap?.(node);
        return;
      }
      if (this.visualState.linkMode) {
        this.handlers.linkNodeTap?.(node);
        return;
      }

      const now = Date.now();
      if (node === this.lastClick.id && now - this.lastClick.time < 350) {
        this.handlers.doubleClickNode?.(node);
        this.lastClick = { id: null, time: 0 };
      } else {
        this.handlers.clickNode?.(node);
        this.lastClick = { id: node, time: now };
      }
      event?.original?.preventDefault?.();
    });

    this.sigma.on('clickEdge', ({ edge }) => {
      const meta = this.edgeMeta[edge];
      if (!meta || !graph) return;
      const src = graph.getNodeAttributes(graph.source(edge));
      const tgt = graph.getNodeAttributes(graph.target(edge));
      const mid = graphToScreen(this.sigma, (src.x + tgt.x) / 2, (src.y + tgt.y) / 2);
      this.handlers.clickEdge?.({
        connId: meta.connId,
        label: meta.label,
        direction: meta.direction,
        kind: meta.kind,
        screenX: mid.x,
        screenY: mid.y,
      });
    });

    this.sigma.on('clickStage', () => {
      this.handlers.clickBackground?.();
    });

    this.sigma.on('downNode', (e) => {
      if (this.visualState.highlightNewMode || this.visualState.linkMode) return;
      if (this.visualState.organizePreview && this.visualState.lockedNodeIds.has(e.node)) return;
      if (this.visualState.manualNodeIds.has(e.node) && !this.visualState.organizePreview) {
        this.draggedNode = e.node;
      } else if (!this.visualState.organizePreview) {
        this.draggedNode = e.node;
      }
    });

    this.sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!this.draggedNode || !graph) return;
      const pos = this.sigma.viewportToGraph(e);
      graph.setNodeAttribute(this.draggedNode, 'x', pos.x);
      graph.setNodeAttribute(this.draggedNode, 'y', pos.y);
      this.sigma.refresh();
    });

    this.sigma.getMouseCaptor().on('mouseup', () => {
      if (this.draggedNode) {
        this.handlers.dragEnd?.(this.draggedNode);
        this.draggedNode = null;
      }
    });

    this.sigma.getCamera().on('updated', () => {
      this.applyLod();
      this.handlers.viewport?.();
    });

    this.sigma.on('afterRender', () => {
      if (!this.paused) this.handlers.render?.();
    });
  }

  /**
   * Merges tier/path/link/highlight overlay state and refreshes the canvas.
   * @param {object} patch
   */
  setVisualState(patch) {
    Object.assign(this.visualState, patch);
    if (patch.newHighlightIds) {
      this.visualState.newHighlightIds = new Set(patch.newHighlightIds);
    }
    if (patch.manualNodeIds) {
      this.visualState.manualNodeIds = new Set(patch.manualNodeIds);
    }
    if (patch.lockedNodeIds) {
      this.visualState.lockedNodeIds = new Set(patch.lockedNodeIds);
    }
    this.sigma?.refresh();
  }

  /** Clears tier/path/link overlays. */
  clearVisualOverlays() {
    this.visualState.tierMap = null;
    this.visualState.pathNodeIds = null;
    this.visualState.pathEdgeIds = null;
    this.visualState.pathFloor = false;
    this.visualState.pathPickDim = false;
    this.visualState.pathSourceId = null;
    this.visualState.linkMode = null;
    this.visualState.linkSourceId = null;
    this.visualState.linkDimOthers = false;
    this.sigma?.refresh();
  }

  /**
   * @param {Map<string, number>} tierMap
   * @param {number} [_maxTier]
   */
  setTierHighlight(tierMap, _maxTier = 3) {
    this.visualState.tierMap = tierMap;
    this.sigma?.refresh();
  }

  /**
   * @param {Set<string>} nodeIds
   * @param {Set<string>} edgeIds
   */
  setPathHighlight(nodeIds, edgeIds) {
    this.visualState.pathNodeIds = nodeIds;
    this.visualState.pathEdgeIds = edgeIds;
    this.visualState.pathFloor = true;
    this.sigma?.refresh();
  }

  /**
   * @param {Set<string>} ids
   * @param {boolean} [flash]
   */
  setNewHighlights(ids, flash = false) {
    this.visualState.highlightNewMode = true;
    this.visualState.newHighlightIds = new Set(ids);
    this.visualState.newHighlightFlash = flash;
    this.sigma?.refresh();
    if (this.flashTimer) clearInterval(this.flashTimer);
    if (flash) {
      this.flashTimer = setInterval(() => {
        this.visualState.newHighlightFlash = !this.visualState.newHighlightFlash;
        this.sigma?.refresh();
      }, 600);
    }
  }

  /** Stops highlight-new flash animation and clears gold rings. */
  clearNewHighlights() {
    if (this.flashTimer) clearInterval(this.flashTimer);
    this.flashTimer = null;
    this.visualState.highlightNewMode = false;
    this.visualState.newHighlightIds = new Set();
    this.visualState.newHighlightFlash = false;
    this.sigma?.refresh();
  }

  /**
   * Runs organize layout on nodes not in manualNodeIds; returns preview positions.
   * @param {Set<string>} manualIds
   * @returns {Record<string, { x: number, y: number }>|null}
   */
  runOrganizePreview(manualIds) {
    if (!this.graph) return null;
    this.organizeSnapshot = this.getPositions();
    const movable = [];
    this.graph.forEachNode((id, attrs) => {
      if (!manualIds.has(id)) movable.push({ id, x: attrs.x, y: attrs.y });
    });
    if (movable.length === 0) return null;

    const edges = [];
    this.graph.forEachEdge((key, _attrs, src, tgt) => {
      edges.push({ source: src, target: tgt });
    });

    const next = runForceLayout2d(movable, edges);
    Object.entries(next).forEach(([id, pos]) => {
      this.graph.setNodeAttribute(id, 'x', pos.x);
      this.graph.setNodeAttribute(id, 'y', pos.y);
    });
    this.visualState.organizePreview = true;
    this.visualState.lockedNodeIds = new Set(manualIds);
    this.sigma?.refresh();
    return next;
  }

  /** Restores positions from before organize preview. */
  cancelOrganizePreview() {
    if (!this.graph || !this.organizeSnapshot) return;
    Object.entries(this.organizeSnapshot).forEach(([id, pos]) => {
      if (this.graph.hasNode(id)) {
        this.graph.setNodeAttribute(id, 'x', pos.x);
        this.graph.setNodeAttribute(id, 'y', pos.y);
      }
    });
    this.organizeSnapshot = null;
    this.visualState.organizePreview = false;
    this.visualState.lockedNodeIds = new Set();
    this.sigma?.refresh();
  }

  /** Commits current positions after organize preview. */
  confirmOrganizePreview() {
    this.organizeSnapshot = null;
    this.visualState.organizePreview = false;
    this.visualState.lockedNodeIds = new Set();
  }

  /** Updates label LOD from current camera ratio. */
  applyLod() {
    if (!this.sigma || !this.graph) return;
    const zoom = this.getDisplayZoom();
    const { hideNodeLabels, hideEdgeLabels } = computeGraphLod(zoom, this.graph.order);
    let changed = false;
    if (hideNodeLabels !== this.lod.hideNodeLabels) {
      this.lod.hideNodeLabels = hideNodeLabels;
      changed = true;
    }
    if (hideEdgeLabels !== this.lod.hideEdgeLabels) {
      this.lod.hideEdgeLabels = hideEdgeLabels;
      changed = true;
    }
    if (changed) this.sigma.refresh();
  }

  /**
   * @param {string} event
   * @param {Function} fn
   */
  on(event, fn) {
    this.handlers[event] = fn;
  }

  /** Cytoscape-compatible zoom for HUD and LOD (inverse of camera ratio). */
  getDisplayZoom() {
    if (!this.sigma) return 1;
    const ratio = this.sigma.getCamera().getState().ratio;
    return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, 1 / Math.max(ratio, 0.01)));
  }

  /** @returns {number} */
  getZoom() {
    return this.getDisplayZoom();
  }

  /** Counts nodes whose positions fall inside the current viewport. */
  countNodesInViewport() {
    if (!this.sigma || !this.graph) return 0;
    const ratio = this.sigma.getCamera().getState().ratio;
    const { width, height } = this.sigma.getDimensions();
    const margin = 40;
    let count = 0;
    this.graph.forEachNode((_id, attrs) => {
      const { x, y } = this.sigma.graphToViewport(attrs);
      if (x >= -margin && y >= -margin && x <= width + margin && y <= height + margin) count += 1;
    });
    return count;
  }

  /** @returns {Record<string, { x: number, y: number }>} */
  getPositions() {
    const pos = {};
    if (!this.graph) return pos;
    this.graph.forEachNode((id, attrs) => {
      pos[id] = { x: attrs.x, y: attrs.y };
    });
    return pos;
  }

  /**
   * @param {Record<string, { x: number, y: number }>} positions
   */
  setPositions(positions) {
    if (!this.graph) return;
    Object.entries(positions).forEach(([id, p]) => {
      if (this.graph.hasNode(id)) {
        this.graph.setNodeAttribute(id, 'x', p.x);
        this.graph.setNodeAttribute(id, 'y', p.y);
      }
    });
    this.sigma?.refresh();
  }

  /**
   * @param {string|number} nodeId
   * @param {number} [ratio]
   */
  centerOn(nodeId, ratio = 1.2) {
    if (!this.sigma || !this.graph) return;
    const id = String(nodeId);
    if (!this.graph.hasNode(id)) return;
    const attrs = this.graph.getNodeAttributes(id);
    const displayZoom = Math.min(Math.max(ratio, GRAPH_MIN_ZOOM), GRAPH_MAX_ZOOM);
    const camRatio = 1 / displayZoom;
    this.sigma.getCamera().animate(
      { x: attrs.x, y: attrs.y, ratio: camRatio },
      { duration: 350 },
    );
  }

  /**
   * @param {string|number|null} nodeId
   */
  setSelected(nodeId) {
    this.selectedNodeId = nodeId ? String(nodeId) : null;
    this.sigma?.refresh();
  }

  /**
   * @param {typeof DEFAULT_EDGE_THEME} theme
   */
  setEdgeTheme(theme) {
    this.edgeTheme = theme;
    this.sigma?.refresh();
  }
}
