/**
 * Cytoscape graph renderer — implements the shared GraphRenderer contract.
 * GraphView2DCyto mounts this adapter; the shell keeps toolbar and edge editor UI.
 *
 * @typedef {import('../GraphRenderer.js').GraphRenderer} GraphRenderer
 */

import cytoscape from 'cytoscape';
import { GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM, GRAPH_PIXEL_RATIO_CAP } from '../constants.js';
import { buildElements, buildGraphFingerprint } from '../elements.js';
import { buildCanonAdjacency } from '../adjacency.js';

/**
 * Standard (Cytoscape) map renderer for small and medium campaigns.
 */
export class CytoscapeRenderer {
  constructor() {
    /** @type {import('cytoscape').Core|null} */
    this.cy = null;
    /** @type {HTMLElement|null} */
    this.container = null;
    /** @type {Record<string, Function>} */
    this.handlers = {};
    this.fingerprint = '';
    /** @type {Map<string, string[]>} */
    this.canonAdj = new Map();
  }

  /**
   * Creates the cytoscape instance inside the container.
   * @param {HTMLElement} container
   * @param {{ elements: object[], style: object[], layout: object, pixelRatio?: number }} opts
   */
  mount(container, opts) {
    this.container = container;
    this.cy = cytoscape({
      container,
      elements: opts.elements,
      style: opts.style,
      layout: opts.layout,
      wheelSensitivity: 0,
      boxSelectionEnabled: false,
      zoomingEnabled: true,
      panningEnabled: true,
      minZoom: GRAPH_MIN_ZOOM,
      maxZoom: GRAPH_MAX_ZOOM,
      pixelRatio: opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, GRAPH_PIXEL_RATIO_CAP),
    });
    return this.cy;
  }

  /** @returns {import('cytoscape').Core|null} */
  getCy() {
    return this.cy;
  }

  /** Destroys the cytoscape instance. */
  destroy() {
    this.cy?.destroy();
    this.cy = null;
    this.container = null;
  }

  /**
   * Rebuilds elements from notes and connections.
   * @param {object[]} notes
   * @param {object[]} connections
   */
  setGraph(notes, connections) {
    if (!this.cy) return;
    this.fingerprint = buildGraphFingerprint(notes, connections);
    this.canonAdj = buildCanonAdjacency(connections);
    const elements = buildElements(notes, connections);
    this.cy.json({ elements });
  }

  /** @returns {string} */
  getFingerprint() {
    return this.fingerprint;
  }

  /** @returns {Map<string, string[]>} */
  getCanonAdjacency() {
    return this.canonAdj;
  }

  /** @returns {number} */
  getZoom() {
    return this.cy?.zoom() ?? 1;
  }

  /** @returns {Record<string, { x: number, y: number }>} */
  getPositions() {
    const pos = {};
    this.cy?.nodes().forEach((n) => { pos[n.id()] = { ...n.position() }; });
    return pos;
  }

  /**
   * @param {string} event
   * @param {Function} fn
   */
  on(event, fn) {
    this.handlers[event] = fn;
  }

  /**
   * @param {string|number} nodeId
   * @param {number} [zoom]
   */
  centerOn(nodeId, zoom = 1.4) {
    const sel = this.cy?.$(`#${nodeId}`);
    if (sel?.length) this.cy.animate({ center: { eles: sel }, zoom }, { duration: 350 });
  }
}
