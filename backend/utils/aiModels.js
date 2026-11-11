/**
 * Anthropic model IDs used by AI features.
 * Scan and recap are independent so they can be upgraded separately.
 */

/** Older Messages API models that still accept a `temperature` field. Default-deny for newer IDs. */
const MODELS_SUPPORTING_TEMPERATURE = new Set([
  'claude-haiku-4-5-20251001',
]);

/**
 * @param {string} [modelId]
 * @returns {boolean}
 */
function modelSupportsTemperature(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return false;
  return MODELS_SUPPORTING_TEMPERATURE.has(id);
}

/**
 * Pull text from an Anthropic Messages response.
 * 5.5+ models may lead with a `thinking` block; never assume content[0] is text.
 * @param {object} data
 * @returns {string}
 */
function extractAssistantText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Glossary suggestion scan (default Claude Haiku 5.5). */
function getGlossaryScanModel() {
  return (process.env.GLOSSARY_SCAN_MODEL || 'claude-haiku-5-5').trim();
}

/** Session summary recap (default Claude Sonnet 5.5). Chronicle uses the per-step getters below. */
function getRecapModel() {
  return (process.env.RECAP_MODEL || 'claude-sonnet-5-5').trim();
}

/** Chronicle step 1 — extract scenes JSON (default Claude Sonnet 5.5). */
function getRecapExtractModel() {
  return (process.env.RECAP_EXTRACT_MODEL || 'claude-sonnet-5-5').trim();
}

/** Chronicle step 2 — write prose from scenes (default Claude Opus 5.5). */
function getRecapWriteModel() {
  return (process.env.RECAP_WRITE_MODEL || 'claude-opus-5-5').trim();
}

/** Chronicle step 3 — verify facts vs prose (default Claude Sonnet 5.5). */
function getRecapVerifyModel() {
  return (process.env.RECAP_VERIFY_MODEL || 'claude-sonnet-5-5').trim();
}

module.exports = {
  getGlossaryScanModel,
  getRecapModel,
  getRecapExtractModel,
  getRecapWriteModel,
  getRecapVerifyModel,
  modelSupportsTemperature,
  MODELS_SUPPORTING_TEMPERATURE,
  extractAssistantText,
};
