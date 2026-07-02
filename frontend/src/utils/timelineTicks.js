import { TIMELINE_AXIS_PAD } from './timelineGeometry.js';

/** Default tick scale settings when none are saved. */
export const DEFAULT_TICK_SETTINGS = {
  enabled: false,
  mode: 'number',
  start: '0',
  end: '100',
  interval: '10',
};

/**
 * Builds the localStorage key for per-user, per-campaign tick settings.
 * @param {number|string|null|undefined} userId
 * @param {number|null|undefined} folderId
 * @returns {string}
 */
export function timelineTickStorageKey(userId, folderId) {
  return `chronicler_timeline_ticks_${userId || 'anon'}_${folderId || 'none'}`;
}

/**
 * Parses tick settings from localStorage JSON with sane defaults.
 * @param {string|null|undefined} raw
 * @returns {typeof DEFAULT_TICK_SETTINGS}
 */
export function parseTickSettings(raw) {
  if (!raw) return { ...DEFAULT_TICK_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      mode: parsed.mode === 'date' ? 'date' : 'number',
      start: String(parsed.start ?? DEFAULT_TICK_SETTINGS.start),
      end: String(parsed.end ?? DEFAULT_TICK_SETTINGS.end),
      interval: String(parsed.interval ?? DEFAULT_TICK_SETTINGS.interval),
    };
  } catch {
    return { ...DEFAULT_TICK_SETTINGS };
  }
}

/**
 * Serializes tick settings for localStorage.
 * @param {typeof DEFAULT_TICK_SETTINGS} settings
 * @returns {string}
 */
export function serializeTickSettings(settings) {
  return JSON.stringify({
    enabled: !!settings.enabled,
    mode: settings.mode === 'date' ? 'date' : 'number',
    start: String(settings.start ?? '').trim(),
    end: String(settings.end ?? '').trim(),
    interval: String(settings.interval ?? '').trim(),
  });
}

/**
 * Parses a user-entered number; returns null when invalid.
 * @param {string|number} raw
 * @returns {number|null}
 */
function parseNumberValue(raw) {
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a user-entered date string to epoch ms; returns null when invalid.
 * @param {string} raw
 * @returns {number|null}
 */
function parseDateValue(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Formats a tick label for number or date mode.
 * @param {'number'|'date'} mode
 * @param {number} value - Numeric value or epoch ms for dates.
 * @returns {string}
 */
export function formatTickLabel(mode, value) {
  if (mode === 'date') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const rounded = Math.abs(value) >= 1000 ? Math.round(value) : Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * Maps a stored anchor x (timeline coordinate) to a scale value using linear interpolation.
 * @param {number} storedAnchorX
 * @param {number} axisStartStored - Stored x at the left labeled edge.
 * @param {number} axisEndStored - Stored x at the right labeled edge.
 * @param {number} startValue
 * @param {number} endValue
 * @returns {number}
 */
export function storedXToScaleValue(storedAnchorX, axisStartStored, axisEndStored, startValue, endValue) {
  const span = axisEndStored - axisStartStored;
  if (Math.abs(span) < 1e-6) return startValue;
  const t = (storedAnchorX - axisStartStored) / span;
  return startValue + t * (endValue - startValue);
}

/**
 * Maps a scale value back to stored anchor x on the axis.
 * @param {number} value
 * @param {number} axisStartStored
 * @param {number} axisEndStored
 * @param {number} startValue
 * @param {number} endValue
 * @returns {number}
 */
export function scaleValueToStoredX(value, axisStartStored, axisEndStored, startValue, endValue) {
  const valueSpan = endValue - startValue;
  if (Math.abs(valueSpan) < 1e-9) return axisStartStored;
  const t = (value - startValue) / valueSpan;
  return axisStartStored + t * (axisEndStored - axisStartStored);
}

/**
 * Computes tick marker positions along the visible axis for SVG rendering.
 * Ticks map linearly from start→end across the drawable axis span (display coordinates).
 * @param {{
 *   settings: typeof DEFAULT_TICK_SETTINGS,
 *   canvasWidth: number,
 *   contentOffsetX: number,
 * }} params
 * @returns {Array<{ x: number, label: string, major: boolean }>}
 */
export function computeTimelineTicks({ settings, canvasWidth, contentOffsetX }) {
  if (!settings?.enabled) return [];

  const axisStartDisplay = TIMELINE_AXIS_PAD;
  const axisEndDisplay = canvasWidth - TIMELINE_AXIS_PAD;
  const axisSpanDisplay = axisEndDisplay - axisStartDisplay;
  if (axisSpanDisplay <= 0) return [];

  const axisStartStored = axisStartDisplay - contentOffsetX;
  const axisEndStored = axisEndDisplay - contentOffsetX;

  if (settings.mode === 'date') {
    const startMs = parseDateValue(settings.start);
    const endMs = parseDateValue(settings.end);
    const intervalDays = parseNumberValue(settings.interval);
    if (startMs == null || endMs == null || intervalDays == null || intervalDays <= 0) return [];
    const stepMs = intervalDays * 86400000;
    const forward = endMs >= startMs;
    const ticks = [];
    let cur = startMs;
    const guard = 500;
    let i = 0;
    while ((forward ? cur <= endMs + stepMs * 0.001 : cur >= endMs - stepMs * 0.001) && i < guard) {
      const storedX = scaleValueToStoredX(cur, axisStartStored, axisEndStored, startMs, endMs);
      const displayX = storedX + contentOffsetX;
      if (displayX >= axisStartDisplay - 1 && displayX <= axisEndDisplay + 1) {
        ticks.push({
          x: displayX,
          label: formatTickLabel('date', cur),
          major: i % 5 === 0,
        });
      }
      cur += forward ? stepMs : -stepMs;
      i += 1;
    }
    return ticks;
  }

  const startNum = parseNumberValue(settings.start);
  const endNum = parseNumberValue(settings.end);
  const interval = parseNumberValue(settings.interval);
  if (startNum == null || endNum == null || interval == null || interval <= 0) return [];

  const forward = endNum >= startNum;
  const ticks = [];
  let cur = startNum;
  const guard = 500;
  let i = 0;
  while ((forward ? cur <= endNum + interval * 0.001 : cur >= endNum - interval * 0.001) && i < guard) {
    const storedX = scaleValueToStoredX(cur, axisStartStored, axisEndStored, startNum, endNum);
    const displayX = storedX + contentOffsetX;
    if (displayX >= axisStartDisplay - 1 && displayX <= axisEndDisplay + 1) {
      ticks.push({
        x: displayX,
        label: formatTickLabel('number', cur),
        major: i % 5 === 0,
      });
    }
    cur += forward ? interval : -interval;
    i += 1;
  }
  return ticks;
}
