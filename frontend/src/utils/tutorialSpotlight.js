/**
 * Viewport spotlight rectangle for the guided tutorial (fixed overlay on document.body).
 * Uses getBoundingClientRect so targets inside a zoomed #root align with the hole.
 * @param {Element|null} el
 * @param {number} [pad=8]
 * @returns {{ top: number, left: number, width: number, height: number, borderRadius: number }|null}
 */
export function measureTutorialSpotlight(el, pad = 8) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
    borderRadius: 8,
  };
}
