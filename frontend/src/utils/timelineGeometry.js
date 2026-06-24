/** Placeholder event box width (px). */
export const TIMELINE_BOX_W = 148;

/** Placeholder event box height (px) — room for title + time. */
export const TIMELINE_BOX_H = 88;

/** Vertical canvas size for the timeline SVG (more room above/below the axis). */
export const TIMELINE_CANVAS_H = 720;

/** Y coordinate of the main horizontal axis within the SVG. */
export const TIMELINE_LINE_Y = TIMELINE_CANVAS_H / 2;

/** Minimum branch length (px) before a release creates a box. */
export const TIMELINE_MIN_BRANCH = 32;

/** Padding at each end of the scrollable axis (px). */
export const TIMELINE_AXIS_PAD = 48;

/** Inset from canvas edges — boxes cannot be dragged past this. */
export const TIMELINE_BOUND_PAD = 12;

/** Pixels added when clicking Past or Present. */
export const TIMELINE_EXTEND_STEP = 480;

/**
 * Distance from a point to a line segment.
 * @param {number} px
 * @param {number} py
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Center point of the box edge nearest to the anchor (relative coords).
 * @param {number} ax
 * @param {number} ay
 * @param {number} boxCx
 * @param {number} boxCy
 * @param {number} boxW
 * @param {number} boxH
 * @returns {[number, number]}
 */
export function nearestEdgeCenter(ax, ay, boxCx, boxCy, boxW = TIMELINE_BOX_W, boxH = TIMELINE_BOX_H) {
  const hw = boxW / 2;
  const hh = boxH / 2;
  const left = boxCx - hw;
  const right = boxCx + hw;
  const top = boxCy - hh;
  const bottom = boxCy + hh;

  const candidates = [
    [left, boxCy],
    [right, boxCy],
    [boxCx, top],
    [boxCx, bottom],
  ];
  const dists = [
    distPointToSegment(ax, ay, left, top, left, bottom),
    distPointToSegment(ax, ay, right, top, right, bottom),
    distPointToSegment(ax, ay, left, top, right, top),
    distPointToSegment(ax, ay, left, bottom, right, bottom),
  ];

  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (dists[i] < dists[best]) best = i;
  }
  return candidates[best];
}

/**
 * True when the target edge center is the top or bottom midpoint of the box.
 * @param {number} ex
 * @param {number} ey
 * @param {number} boxCx
 * @param {number} boxCy
 * @param {number} boxH
 * @returns {boolean}
 */
function isTopOrBottomEdgeCenter(ex, ey, boxCx, boxCy, boxH) {
  const hh = boxH / 2;
  const onTop = Math.abs(ey - (boxCy - hh)) < 1 && Math.abs(ex - boxCx) < 1;
  const onBottom = Math.abs(ey - (boxCy + hh)) < 1 && Math.abs(ex - boxCx) < 1;
  return onTop || onBottom;
}

/**
 * Vertical “tetris Z” path: half down, across, half to the top/bottom edge center.
 * @param {number} tx - Target x (edge center).
 * @param {number} ty - Target y (edge center).
 * @returns {Array<[number, number]>}
 */
function buildVerticalZPath(tx, ty) {
  const midY = ty / 2;
  if (Math.abs(tx) < 0.5) {
    return [[0, 0], [0, ty]];
  }
  return [[0, 0], [0, midY], [tx, midY], [tx, ty]];
}

/**
 * Builds a strictly orthogonal (90°) branch from the axis anchor to an edge center.
 * Uses a Z-shaped route when the anchor sits within the box width and the target is top/bottom.
 * @param {number} endX - Box center offset from anchor along X.
 * @param {number} endY - Box center offset from axis along Y.
 * @param {number} boxW
 * @param {number} boxH
 * @returns {Array<[number, number]>}
 */
export function buildBranchPathToBox(endX, endY, boxW = TIMELINE_BOX_W, boxH = TIMELINE_BOX_H) {
  const hw = boxW / 2;
  const [ex, ey] = nearestEdgeCenter(0, 0, endX, endY, boxW, boxH);
  const underBoxFootprint = Math.abs(endX) <= hw;

  if (underBoxFootprint && isTopOrBottomEdgeCenter(ex, ey, endX, endY, boxH)) {
    return buildVerticalZPath(ex, ey);
  }

  if (Math.abs(ex) < 0.5) {
    return [[0, 0], [0, ey]];
  }
  if (Math.abs(ey) < 0.5) {
    return [[0, 0], [ex, 0]];
  }
  return [[0, 0], [0, ey], [ex, ey]];
}

/** @deprecated Use {@link buildBranchPathToBox}. */
export function buildBranchPath(endX, endY) {
  return buildBranchPathToBox(endX, endY);
}

/**
 * Clamps box center offsets so the full box stays inside the timeline canvas.
 * @param {number} anchorDisplayX - Anchor position in SVG x coords.
 * @param {number} endX - Box center x offset from anchor.
 * @param {number} endY - Box center y offset from axis.
 * @param {number} canvasWidth
 * @returns {{ endX: number, endY: number }}
 */
export function clampBoxOffsets(anchorDisplayX, endX, endY, canvasWidth) {
  const hw = TIMELINE_BOX_W / 2;
  const hh = TIMELINE_BOX_H / 2;
  const pad = TIMELINE_BOUND_PAD;

  const minEndY = pad + hh - TIMELINE_LINE_Y;
  const maxEndY = TIMELINE_CANVAS_H - pad - hh - TIMELINE_LINE_Y;
  const minEndX = TIMELINE_AXIS_PAD + hw - anchorDisplayX;
  const maxEndX = canvasWidth - TIMELINE_AXIS_PAD - hw - anchorDisplayX;

  return {
    endX: Math.max(minEndX, Math.min(endX, maxEndX)),
    endY: Math.max(minEndY, Math.min(endY, maxEndY)),
  };
}

/**
 * Clamps anchor x so a box at fixed offsets stays inside the canvas.
 * @param {number} anchorDisplayX
 * @param {number} endX
 * @param {number} canvasWidth
 * @returns {number}
 */
export function clampAnchorDisplayX(anchorDisplayX, endX, canvasWidth) {
  const hw = TIMELINE_BOX_W / 2;
  const pad = TIMELINE_BOUND_PAD;
  const boxMin = pad + hw;
  const boxMax = canvasWidth - pad - hw;
  const lo = Math.max(TIMELINE_AXIS_PAD, boxMin - endX);
  const hi = Math.min(canvasWidth - TIMELINE_AXIS_PAD, boxMax - endX);
  if (lo > hi) return anchorDisplayX;
  return Math.max(lo, Math.min(anchorDisplayX, hi));
}

/**
 * Pushes one timeline entry back inside the canvas after a trim (anchor + box).
 * @param {object} entry
 * @param {number} extendLeft - Past extension offset applied to display x.
 * @param {number} canvasWidth
 * @returns {object}
 */
export function clampEntryGeometryToCanvas(entry, extendLeft, canvasWidth) {
  let storedAnchor = entry.anchor_x ?? 0;
  let endX = entry.end_x ?? 0;
  let endY = entry.end_y ?? 0;

  let displayAx = storedAnchor + extendLeft;
  displayAx = Math.max(TIMELINE_AXIS_PAD, Math.min(displayAx, canvasWidth - TIMELINE_AXIS_PAD));
  displayAx = clampAnchorDisplayX(displayAx, endX, canvasWidth);
  storedAnchor = displayAx - extendLeft;

  const box = clampBoxOffsets(displayAx, endX, endY, canvasWidth);
  endX = box.endX;
  endY = box.endY;

  return entryWithGeometry(entry, storedAnchor, endX, endY);
}

/**
 * Returns true when two entries differ in stored geometry fields.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function timelineGeometryChanged(a, b) {
  return (a.anchor_x ?? 0) !== (b.anchor_x ?? 0)
    || (a.end_x ?? 0) !== (b.end_x ?? 0)
    || (a.end_y ?? 0) !== (b.end_y ?? 0);
}

/**
 * Serializes a branch path for API storage.
 * @param {Array<[number, number]>} path
 * @returns {string}
 */
export function serializeBranchPath(path) {
  return JSON.stringify(path);
}

/**
 * Resolves the branch path for rendering (always derived from box position).
 * @param {string|null|undefined} _raw
 * @param {number} endX
 * @param {number} endY
 * @returns {Array<[number, number]>}
 */
export function parseBranchPath(_raw, endX, endY) {
  return buildBranchPathToBox(endX, endY);
}

/**
 * Converts path array to an SVG polyline points attribute (anchor-relative).
 * @param {number} anchorX
 * @param {number} lineY
 * @param {Array<[number, number]>} path
 * @returns {string}
 */
export function pathToSvgPoints(anchorX, lineY, path) {
  return path.map(([dx, dy]) => `${anchorX + dx},${lineY + dy}`).join(' ');
}

/**
 * Computes horizontal content bounds in SVG display coordinates.
 * @param {Array<{ anchor_x?: number, end_x?: number }>} entries
 * @param {number} extendLeft
 * @returns {{ minX: number, maxX: number }}
 */
export function computeContentBounds(entries, extendLeft = 0) {
  const hw = TIMELINE_BOX_W / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const e of entries || []) {
    const ax = (e.anchor_x ?? 0) + extendLeft;
    const cx = ax + (e.end_x ?? 0);
    minX = Math.min(minX, ax, cx - hw);
    maxX = Math.max(maxX, ax, cx + hw);
  }
  if (!Number.isFinite(minX)) {
    return { minX: TIMELINE_AXIS_PAD + extendLeft, maxX: TIMELINE_AXIS_PAD + extendLeft };
  }
  return { minX, maxX };
}

/**
 * Removes unused Past/Present padding while keeping every box on canvas.
 * @param {Array<{ anchor_x?: number, end_x?: number }>} entries
 * @param {number} viewportWidth
 * @param {{ left: number, right: number }} axisExtend
 * @returns {{ left: number, right: number, leftDelta: number }}
 */
export function trimAxisExtend(entries, viewportWidth, axisExtend) {
  const base = Math.max(viewportWidth || 720, 720);
  const hw = TIMELINE_BOX_W / 2;
  let minStoredLeft = Infinity;
  let maxStoredRight = -Infinity;
  for (const e of entries || []) {
    const ax = e.anchor_x ?? 0;
    const cx = ax + (e.end_x ?? 0);
    minStoredLeft = Math.min(minStoredLeft, ax, cx - hw);
    maxStoredRight = Math.max(maxStoredRight, ax, cx + hw);
  }
  if (!Number.isFinite(minStoredLeft)) {
    return { left: 0, right: 0, leftDelta: 0 };
  }

  const minExtendLeft = Math.max(0, Math.ceil(TIMELINE_AXIS_PAD - minStoredLeft));
  const newLeft = minExtendLeft;

  const neededWidth = Math.max(base, maxStoredRight + newLeft + TIMELINE_AXIS_PAD);
  const currentWidth = base + axisExtend.left + axisExtend.right;
  const newRight = Math.max(0, axisExtend.right - Math.max(0, currentWidth - neededWidth));
  const leftDelta = axisExtend.left - newLeft;

  return { left: newLeft, right: newRight, leftDelta };
}

/**
 * Canvas width is driven only by viewport size and manual Past/Present extensions — not box positions.
 * @param {number} viewportWidth
 * @param {number} extendLeft
 * @param {number} extendRight
 * @returns {number}
 */
export function computeCanvasWidth(viewportWidth, extendLeft = 0, extendRight = 0) {
  const base = Math.max(viewportWidth || 720, 720);
  return base + extendLeft + extendRight;
}

/**
 * Ensures saved content is visible after load by growing extend values only when necessary.
 * Does not shrink extensions; use {@link trimAxisExtend} for that.
 * @param {Array<{ anchor_x?: number, end_x?: number }>} entries
 * @param {number} viewportWidth
 * @param {{ left: number, right: number }} axisExtend
 * @returns {{ left: number, right: number }}
 */
export function ensureAxisExtendFitsContent(entries, viewportWidth, axisExtend) {
  const base = Math.max(viewportWidth || 720, 720);
  const hw = TIMELINE_BOX_W / 2;
  let minStoredLeft = Infinity;
  let maxStoredRight = -Infinity;
  for (const e of entries || []) {
    const ax = e.anchor_x ?? 0;
    const cx = ax + (e.end_x ?? 0);
    minStoredLeft = Math.min(minStoredLeft, ax, cx - hw);
    maxStoredRight = Math.max(maxStoredRight, ax, cx + hw);
  }
  if (!Number.isFinite(minStoredLeft)) return axisExtend;

  let left = Math.max(axisExtend.left, Math.max(0, Math.ceil(TIMELINE_AXIS_PAD - minStoredLeft)));
  let right = axisExtend.right;

  const displayMax = maxStoredRight + left + TIMELINE_AXIS_PAD;
  const canvasW = base + left + right;
  if (displayMax > canvasW) {
    right += displayMax - canvasW;
  }

  return { left, right };
}

/**
 * Resolves the display title shown on a timeline box.
 * @param {object} entry
 * @returns {string}
 */
export function timelineBoxTitle(entry) {
  if (entry?.label_override?.trim()) return entry.label_override.trim();
  if (entry?.display_label?.trim()) return entry.display_label.trim();
  if (entry?.note_title?.trim()) return entry.note_title.trim();
  if (entry?.is_placeholder) return 'Click to add note';
  return 'Untitled';
}

/**
 * Converts a #rrggbb color to rgba for timeline fills and strokes.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
export function hexToRgba(hex, alpha) {
  const h = String(hex || '#4a5568').replace('#', '');
  if (h.length < 6) return `rgba(200, 148, 58, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Minimum pixel movement before a pointer gesture counts as a drag (not a click).
 */
export const TIMELINE_CLICK_THRESHOLD = 5;

/**
 * Applies geometry fields to a timeline entry object for optimistic UI updates.
 * @param {object} entry
 * @param {number} anchorX
 * @param {number} endX
 * @param {number} endY
 * @returns {object}
 */
export function entryWithGeometry(entry, anchorX, endX, endY) {
  const path = buildBranchPathToBox(endX, endY);
  return {
    ...entry,
    anchor_x: anchorX,
    end_x: endX,
    end_y: endY,
    sort_order: anchorX,
    path_json: serializeBranchPath(path),
  };
}
