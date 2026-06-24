/**
 * SVG ↔ viewport coordinate helpers that stay accurate when ancestors use CSS zoom.
 * getScreenCTM() does not always include zoom correctly in Chromium, which skews
 * pointer hit-testing on wide scrolled canvases (e.g. Timeline).
 */

/**
 * Returns the applied text-scale zoom on #root (1 when unset).
 * @param {HTMLElement | null} [root]
 * @returns {number}
 */
export function getRootTextScale(root = document.getElementById('root')) {
  if (!root) return 1;
  const raw = root.style.zoom;
  if (!raw) return 1;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Maps a viewport pointer position to SVG user units for an SVG with explicit width/height.
 * @param {SVGSVGElement} svg
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ x: number, y: number }|null}
 */
export function clientPointToSvgUser(svg, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const w = svg.width?.baseVal?.value ?? 0;
  const h = svg.height?.baseVal?.value ?? 0;
  if (!rect.width || !rect.height || !w || !h) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * w,
    y: ((clientY - rect.top) / rect.height) * h,
  };
}

/**
 * Maps SVG user units to viewport client coordinates (for animation anchors / overlays).
 * @param {SVGSVGElement} svg
 * @param {number} userX
 * @param {number} userY
 * @returns {{ x: number, y: number }|null}
 */
export function svgUserPointToClient(svg, userX, userY) {
  const rect = svg.getBoundingClientRect();
  const w = svg.width?.baseVal?.value ?? 0;
  const h = svg.height?.baseVal?.value ?? 0;
  if (!rect.width || !rect.height || !w || !h) return null;
  return {
    x: rect.left + (userX / w) * rect.width,
    y: rect.top + (userY / h) * rect.height,
  };
}
