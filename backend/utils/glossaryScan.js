/**
 * Scan one session's journal for glossary suggestions via Claude.
 */
const db = require('../db/database');
const { getGlossaryScanModel } = require('./aiModels');
const {
  getGlossaryForSession,
  getTopLevelScopeForNote,
  ensureGlossaryForScope,
  getScanBlocklist,
  getPlayedByTitles,
  findEntryByName,
  insertSuggestedEntryIgnore,
  insertSuggestedAliasIgnore,
  isValidType,
  normalizeName,
} = require('./glossary');
const { getCampaignFolderId } = require('./access');

const ENTRY_TYPES = ['npc', 'place', 'item', 'faction', 'other'];

/**
 * Validate Claude JSON shape for glossary scan.
 * @param {unknown} data
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateScanPayload(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'not an object' };
  const new_entries = data.new_entries;
  const alias_suggestions = data.alias_suggestions;
  if (!Array.isArray(new_entries)) return { ok: false, error: 'new_entries must be an array' };
  if (!Array.isArray(alias_suggestions)) return { ok: false, error: 'alias_suggestions must be an array' };

  const cleanedEntries = [];
  for (const e of new_entries) {
    if (!e || typeof e !== 'object') continue;
    const name = normalizeName(e.name);
    const type = String(e.type || '').toLowerCase();
    const description = String(e.description || '').trim();
    if (!name || !isValidType(type) || !description) continue;
    const aliases = Array.isArray(e.aliases)
      ? e.aliases.map((a) => normalizeName(a)).filter(Boolean)
      : [];
    cleanedEntries.push({ name, type, description, aliases });
  }

  const cleanedAliases = [];
  for (const a of alias_suggestions) {
    if (!a || typeof a !== 'object') continue;
    const existing_name = normalizeName(a.existing_name);
    const alias = normalizeName(a.alias);
    if (!existing_name || !alias) continue;
    cleanedAliases.push({ existing_name, alias });
  }

  return { ok: true, value: { new_entries: cleanedEntries, alias_suggestions: cleanedAliases } };
}

function loadJournalText(sessionId) {
  const entries = db.prepare(`
    SELECT je.content, je.indent_level, u.username as author
    FROM journal_entries je
    JOIN users u ON u.id = je.user_id
    WHERE je.session_id = ? AND je.is_session_break = 0
    ORDER BY je.sort_order ASC, je.id ASC
  `).all(sessionId);
  return entries.map((e) => {
    const indent = '  '.repeat(e.indent_level || 0);
    return `${indent}[Player: ${e.author}]: ${e.content}`;
  }).join('\n');
}

function approvedGlossaryDigest(glossaryId) {
  const entries = db.prepare(`
    SELECT id, name, type FROM glossary_entries
    WHERE glossary_id = ? AND status IN ('approved', 'suggested')
    ORDER BY name ASC
  `).all(glossaryId);
  return entries.map((e) => {
    const aliases = db.prepare(`
      SELECT alias FROM glossary_entry_aliases
      WHERE entry_id = ? AND status IN ('approved', 'suggested')
    `).all(e.id).map((a) => a.alias);
    return aliases.length
      ? `${e.name} (${e.type}); also: ${aliases.join(', ')}`
      : `${e.name} (${e.type})`;
  }).join('\n');
}

async function callClaudeScan({ system, user }) {
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'ai_api_key'").get()?.value?.trim();
  if (!apiKey) {
    const err = new Error('No Anthropic API key configured.');
    err.code = 'NO_KEY';
    throw err;
  }
  const aiEnabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_enabled'").get();
  if (aiEnabled?.value !== 'true') {
    const err = new Error('AI features are not enabled.');
    err.code = 'AI_OFF';
    throw err;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    // Haiku 5.5+ rejects `temperature`; omit it (extraction does not need sampling).
    body: JSON.stringify({
      model: getGlossaryScanModel(),
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const err = new Error(errBody?.error?.message || 'Anthropic API error');
    err.code = 'API';
    throw err;
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || '';
  // Allow fenced JSON
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : text;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error('Invalid JSON from model');
    err.code = 'PARSE';
    err.raw = text.slice(0, 500);
    throw err;
  }
  const validated = validateScanPayload(parsed);
  if (!validated.ok) {
    const err = new Error(`Invalid scan shape: ${validated.error}`);
    err.code = 'VALIDATE';
    throw err;
  }
  return validated.value;
}

/**
 * Run scan for one session; persist suggestions.
 * @param {number} sessionId
 * @param {{ retry?: boolean }} [opts]
 * @returns {Promise<{ ok: true, added_entries: number, added_aliases: number } | { ok: false, error: string, retryable?: boolean }>}
 */
async function scanSessionGlossary(sessionId, opts = {}) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session?.folder_id) return { ok: false, error: 'Session not found' };

  const scopeId = getTopLevelScopeForNote(session.folder_id);
  if (!scopeId) return { ok: false, error: 'No glossary scope for session' };

  const { glossary } = ensureGlossaryForScope(scopeId);
  const campaignId = getCampaignFolderId(session.folder_id);
  const journalText = loadJournalText(sessionId);
  if (!journalText.trim()) return { ok: true, added_entries: 0, added_aliases: 0 };

  const blocklist = getScanBlocklist(glossary.id);
  const pcTitles = getPlayedByTitles(scopeId);
  const digest = approvedGlossaryDigest(glossary.id);

  const system = `You extract proper nouns for a D&D campaign glossary from journal notes.
Return ONLY valid JSON with this shape:
{"new_entries":[{"name":"string","type":"npc|place|item|faction|other","description":"one line from the notes only","aliases":["optional"]}],"alias_suggestions":[{"existing_name":"string","alias":"string"}]}
Rules:
- Only use facts present in the journal text.
- Descriptions must be one short line taken from the notes.
- Do not invent entries.
- Skip player character names listed under PC_SKIP.
- Do not suggest any name or alias in BLOCKLIST (already known or dismissed).
- alias_suggestions are alternate spellings/names for EXISTING glossary entries only.
- Types must be one of: ${ENTRY_TYPES.join(', ')}.`;

  const user = `EXISTING_GLOSSARY:
${digest || '(empty)'}

PC_SKIP:
${pcTitles.length ? pcTitles.join(', ') : '(none)'}

BLOCKLIST (do not suggest these names/aliases):
${[...blocklist].join(', ') || '(none)'}

JOURNAL:
${journalText}`;

  let payload;
  try {
    payload = await callClaudeScan({ system, user });
  } catch (e) {
    console.error('[glossaryScan]', e.code || '', e.message, e.raw || '');
    const retryable = e.code === 'PARSE' || e.code === 'VALIDATE' || e.code === 'API';
    if (e.code === 'NO_KEY' || e.code === 'AI_OFF') {
      return { ok: false, error: e.message, retryable: false };
    }
    if (opts.retry && retryable) {
      try {
        payload = await callClaudeScan({ system, user });
      } catch (e2) {
        console.error('[glossaryScan] retry failed', e2.code || '', e2.message);
        return { ok: false, error: e2.message || 'Scan failed, try again', retryable: false };
      }
    } else {
      return { ok: false, error: e.message || 'Scan failed, try again', retryable };
    }
  }

  let added_entries = 0;
  let added_aliases = 0;

  for (const e of payload.new_entries) {
    if (blocklist.has(e.name.toLowerCase())) continue;
    if (pcTitles.some((t) => t.toLowerCase() === e.name.toLowerCase())) continue;
    const row = insertSuggestedEntryIgnore(glossary.id, {
      name: e.name,
      type: e.type,
      description: e.description,
      campaign_id: campaignId,
    });
    if (row) {
      added_entries += 1;
      blocklist.add(e.name.toLowerCase());
      for (const al of e.aliases || []) {
        if (blocklist.has(al.toLowerCase())) continue;
        const arow = insertSuggestedAliasIgnore(glossary.id, row.id, al);
        if (arow) {
          added_aliases += 1;
          blocklist.add(al.toLowerCase());
        }
      }
    }
  }

  for (const a of payload.alias_suggestions) {
    if (blocklist.has(a.alias.toLowerCase())) continue;
    const entry = findEntryByName(glossary.id, a.existing_name);
    if (!entry || entry.status === 'dismissed') continue;
    const arow = insertSuggestedAliasIgnore(glossary.id, entry.id, a.alias);
    if (arow) {
      added_aliases += 1;
      blocklist.add(a.alias.toLowerCase());
    }
  }

  return { ok: true, added_entries, added_aliases };
}

/** Debounce map: sessionId -> timeout */
const debounceTimers = new Map();

function scheduleDebouncedSessionScan(sessionId) {
  const prev = debounceTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    debounceTimers.delete(sessionId);
    scanSessionGlossary(sessionId, { retry: true }).catch((e) => {
      console.error('[glossaryScan] debounced', e.message);
    });
  }, 25000);
  debounceTimers.set(sessionId, t);
}

module.exports = {
  validateScanPayload,
  scanSessionGlossary,
  scheduleDebouncedSessionScan,
};
