/**
 * Anthropic model IDs used by AI features.
 * Scan and recap are independent so they can be upgraded separately.
 */

/** Glossary suggestion scan (default Claude Haiku 5.5). */
function getGlossaryScanModel() {
  return (process.env.GLOSSARY_SCAN_MODEL || 'claude-haiku-5-5').trim();
}

/** Session recap generation (default pinned Haiku 4.5 until Sonnet switch). */
function getRecapModel() {
  return (process.env.RECAP_MODEL || 'claude-haiku-4-5-20251001').trim();
}

module.exports = { getGlossaryScanModel, getRecapModel };
