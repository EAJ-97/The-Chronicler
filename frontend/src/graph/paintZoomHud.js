import { zoomPerformanceZone } from './lod.js';

/**
 * Updates zoom HUD DOM for either cytoscape or WebGL renderer.
 * @param {HTMLElement|null} el
 * @param {{ zoom: number, nodes: number, edges: number, engine: string, visibleInView?: number|null }} stats
 */
export function paintZoomHud(el, stats) {
  if (!el) return;
  const { zoom, nodes, edges, engine, visibleInView } = stats;
  const zoomEl = el.querySelector('[data-zoom]');
  const statsEl = el.querySelector('[data-stats]');
  const zoneEl = el.querySelector('[data-zone]');
  const visibleEl = el.querySelector('[data-visible]');
  const engineEl = el.querySelector('[data-engine]');
  if (zoomEl) zoomEl.textContent = `${zoom.toFixed(2)}× (${Math.round(zoom * 100)}%)`;
  if (statsEl) statsEl.textContent = `${nodes} nodes · ${edges} edges`;
  if (zoneEl) zoneEl.textContent = zoomPerformanceZone(zoom);
  if (visibleEl) {
    visibleEl.textContent = visibleInView != null
      ? `${visibleInView} nodes in view`
      : '—';
  }
  if (engineEl) engineEl.textContent = engine;
}
