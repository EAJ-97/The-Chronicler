const db = require('../db/database');

/**
 * Whether the server supplies a Gemini key via environment (takes precedence over DB).
 * @returns {boolean}
 */
function geminiIconKeyFromEnv() {
  const a = (process.env.GEMINI_API_KEY || process.env.GEMINI_ICON_API_KEY || '').trim();
  return a.length > 0;
}

/**
 * API key for Gemini “Nano Banana” image models used only for chronicle sidebar icons.
 * Environment variables GEMINI_API_KEY or GEMINI_ICON_API_KEY override the database value.
 * @returns {string}
 */
function getGeminiIconApiKey() {
  const env = (process.env.GEMINI_API_KEY || process.env.GEMINI_ICON_API_KEY || '').trim();
  if (env) return env;
  return db.prepare("SELECT value FROM settings WHERE key = 'gemini_icon_api_key'").get()?.value?.trim() || '';
}

module.exports = { getGeminiIconApiKey, geminiIconKeyFromEnv };
