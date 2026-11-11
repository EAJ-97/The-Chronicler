const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { getRootFolderId, getCampaignFolderId } = require('./access');
const {
  ensureGlossaryForScope,
  getTopLevelScopeForNote,
  getApprovedEntriesForRecap,
  formatGlossaryBlock,
} = require('./glossary');

const STYLE_EXAMPLE_PATH = path.join(__dirname, '../prompts/style_example.md');

/**
 * Load chronicle style sample once (empty string if missing).
 * @returns {string}
 */
function loadStyleExample() {
  try {
    return fs.readFileSync(STYLE_EXAMPLE_PATH, 'utf8').trim();
  } catch (e) {
    console.error('[recapPromptBuild] style_example.md missing', e.message);
    return '';
  }
}

/**
 * Split model output into optional ## subtitle and body. Never throws.
 * @param {string} raw
 * @returns {{ subtitle: string|null, body: string }}
 */
function parseModelRecapOutput(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!text) return { subtitle: null, body: '' };
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length) return { subtitle: null, body: '' };
  const first = lines[i].trim();
  if (first.startsWith('## ')) {
    const subtitle = first.slice(3).trim() || null;
    let j = i + 1;
    if (j < lines.length && !lines[j].trim()) j += 1;
    const body = lines.slice(j).join('\n').trim();
    return { subtitle, body };
  }
  return { subtitle: null, body: text };
}

/**
 * Soft-strip accidental model H1 that duplicates our app title.
 * @param {string} body
 * @returns {string}
 */
function stripDuplicateTitleHeadings(body) {
  let t = String(body || '').trim();
  const lines = t.split(/\r?\n/);
  if (lines.length && /^#\s+(Chronicle|Summary)\s+of\b/i.test(lines[0].trim())) {
    let i = 1;
    if (i < lines.length && !lines[i].trim()) i += 1;
    t = lines.slice(i).join('\n').trim();
  }
  return t;
}

/**
 * Build stored markdown: app H1 + optional session line + optional ## subtitle + body.
 * @param {{ tone: string, worldTitle?: string|null, campaignTitle?: string|null, sessionNumber?: number|null, subtitle?: string|null, body: string }} opts
 * @returns {string}
 */
function assembleRecapMarkdown(opts) {
  const tone = opts.tone === 'summary' ? 'summary' : 'chronicle';
  const campaign = (opts.campaignTitle || 'Unknown Campaign').trim();
  const world = opts.worldTitle ? String(opts.worldTitle).trim() : '';
  const kind = tone === 'summary' ? 'Summary' : 'Chronicle';
  const h1 = world
    ? `# ${kind} of ${world}: ${campaign}`
    : `# ${kind} of ${campaign}`;

  const parts = [h1];
  if (opts.sessionNumber != null && opts.sessionNumber !== '') {
    parts.push('');
    parts.push(`*Session ${opts.sessionNumber}*`);
  }
  const subtitle = opts.subtitle ? String(opts.subtitle).trim() : '';
  if (subtitle) {
    parts.push('');
    parts.push(`## ${subtitle.replace(/^#+\s*/, '')}`);
  }
  const body = stripDuplicateTitleHeadings(opts.body || '');
  if (body) {
    parts.push('');
    parts.push(body);
  }
  return parts.join('\n').trim() + '\n';
}

/**
 * App timezone for journal date headers (default America/Chicago).
 * @returns {string}
 */
function getAppTimezone() {
  return (process.env.APP_TIMEZONE || 'America/Chicago').trim() || 'America/Chicago';
}

/**
 * Parse SQLite CURRENT_TIMESTAMP style strings as UTC (matches journal UI).
 * @param {string|null|undefined} dateStr
 * @returns {Date}
 */
function parseSqliteUtc(dateStr) {
  if (!dateStr) return new Date(NaN);
  const s = String(dateStr);
  return new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

/**
 * Local calendar day key + uppercase display label in APP_TIMEZONE.
 * @param {string} dateStr
 * @returns {{ dayKey: string, label: string }}
 */
function localDayParts(dateStr) {
  const d = parseSqliteUtc(dateStr);
  const tz = getAppTimezone();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const label = fmt.format(d).toUpperCase();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return { dayKey: `${y}-${m}-${day}`, label };
}

/**
 * Journal entries for one session (recap source of truth).
 * @param {number} sessionId
 * @returns {Array<{ content: string, indent_level: number, author: string, user_id: number, created_at: string }>}
 */
function loadSessionJournalEntries(sessionId) {
  return db.prepare(`
    SELECT je.content, je.indent_level, je.user_id, je.created_at, u.username as author
    FROM journal_entries je
    JOIN users u ON u.id = je.user_id
    WHERE je.session_id = ? AND je.is_session_break = 0
    ORDER BY je.sort_order ASC, je.id ASC
  `).all(sessionId);
}

/**
 * Campaign + optional world titles for a session folder.
 * @param {number|null} folderId
 * @returns {{ campaignTitle: string|null, worldTitle: string|null, campaignId: number|null }}
 */
function resolveSessionScopeTitles(folderId) {
  if (!folderId) return { campaignTitle: null, worldTitle: null, campaignId: null };
  const campaignId = getCampaignFolderId(folderId);
  const rootId = getRootFolderId(folderId);
  const campaign = campaignId
    ? db.prepare('SELECT id, title, is_world FROM notes WHERE id = ?').get(campaignId)
    : null;
  const root = rootId
    ? db.prepare('SELECT id, title, is_world FROM notes WHERE id = ?').get(rootId)
    : null;
  const worldTitle = root?.is_world ? root.title : null;
  let campaignTitle = null;
  if (campaign && !campaign.is_world) campaignTitle = campaign.title;
  else if (root && !root.is_world) campaignTitle = root.title;
  return { campaignTitle, worldTitle, campaignId: campaignId || null };
}

/**
 * Walk campaign subtree for notes with played_by set.
 * @param {number} campaignFolderId
 * @returns {Array<{ id: number, title: string, played_by: number, username: string }>}
 */
function listPlayedByNotes(campaignFolderId) {
  const rows = [];
  const queue = [campaignFolderId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const kids = db.prepare(`
      SELECT n.id, n.title, n.played_by, n.is_folder, u.username
      FROM notes n
      LEFT JOIN users u ON u.id = n.played_by
      WHERE n.parent_id = ? AND n.deleted_at IS NULL
    `).all(id);
    for (const k of kids) {
      if (k.played_by && !k.is_folder && k.username) {
        rows.push({
          id: k.id,
          title: k.title,
          played_by: k.played_by,
          username: k.username,
        });
      }
      if (k.is_folder) queue.push(k.id);
    }
  }
  return rows;
}

/**
 * Map user_id → character title (highest note id wins when multiple PCs).
 * @param {number} campaignFolderId
 * @returns {Map<number, string>}
 */
function buildAuthorCharacterMap(campaignFolderId) {
  const map = new Map();
  if (!campaignFolderId) return map;
  const notes = listPlayedByNotes(campaignFolderId);
  // Sort ascending so later (higher id) overwrites
  notes.sort((a, b) => a.id - b.id);
  for (const n of notes) {
    map.set(n.played_by, n.title);
  }
  return map;
}

/**
 * Build <party> block lines from played_by notes (unique by character note).
 * @param {number|null} campaignFolderId
 * @returns {string}
 */
function formatPartyBlock(campaignFolderId) {
  if (!campaignFolderId) return '';
  const notes = listPlayedByNotes(campaignFolderId);
  if (!notes.length) return '<party>\n</party>';
  // Stable order by character title
  notes.sort((a, b) => String(a.title).localeCompare(String(b.title)) || a.id - b.id);
  const lines = notes.map((n) => `${n.title} (played by ${n.username})`);
  return `<party>\n${lines.join('\n')}\n</party>`;
}

/**
 * Detect speaker from a prior journal line (says/said/asks/tells us only).
 * @param {string|null|undefined} prevContent
 * @returns {string|null}
 */
function speakerFromPreviousLine(prevContent) {
  if (!prevContent) return null;
  const m = String(prevContent).trim().match(
    /^(.+?)\s+(says|said|asks|tells us)\b/i,
  );
  if (!m) return null;
  const name = m[1].trim().replace(/[.,;:!?]+$/, '');
  if (!name || name.length > 80) return null;
  return name;
}

/**
 * Wrap a journal line body if it is a full quoted string.
 * @param {string} content
 * @param {string|null} speaker
 * @returns {string}
 */
function maybeWrapQuote(content, speaker) {
  const t = String(content ?? '');
  const trimmed = t.trim();
  if (trimmed.length < 2) return t;
  const open = trimmed[0];
  const close = trimmed[trimmed.length - 1];
  const pairs = {
    '"': '"',
    "'": "'",
    '\u201c': '\u201d',
    '\u2018': '\u2019',
  };
  if (!pairs[open] || pairs[open] !== close) return t;
  const inner = trimmed.slice(1, -1);
  if (speaker) return `<quote speaker="${speaker}">${inner}</quote>`;
  return `<quote>${inner}</quote>`;
}

/**
 * Format <journal> body: date headers, authorship groups, bullets, quotes.
 * @param {Array<{ content: string, indent_level: number, user_id: number, created_at: string, author: string }>} entries
 * @param {Map<number, string>} authorToCharacter
 * @returns {string}
 */
function formatJournalBlock(entries, authorToCharacter) {
  // Group by author in first-appearance order; keep internal order
  const order = [];
  const groups = new Map();
  for (const e of entries) {
    const uid = e.user_id;
    if (!groups.has(uid)) {
      groups.set(uid, []);
      order.push(uid);
    }
    groups.get(uid).push(e);
  }

  const linkedAuthors = order.filter((uid) => authorToCharacter.has(uid));
  const singleLinkedAuthor = order.length === 1 && linkedAuthors.length === 1;

  const lines = [];
  let lastDayKey = null;

  const pushEntryLines = (list, prevContentRef) => {
    for (const e of list) {
      const { dayKey, label } = localDayParts(e.created_at);
      if (dayKey !== lastDayKey) {
        lines.push(label);
        lastDayKey = dayKey;
      }
      const speaker = speakerFromPreviousLine(prevContentRef.value);
      const body = maybeWrapQuote(e.content, speaker);
      const indent = '  '.repeat(e.indent_level || 0);
      lines.push(`${indent}- ${body}`);
      prevContentRef.value = e.content;
    }
  };

  if (singleLinkedAuthor) {
    const charName = authorToCharacter.get(order[0]);
    lines.push(
      `Notes written from ${charName}'s perspective. We/us/our means the party.`,
    );
    const prev = { value: null };
    pushEntryLines(groups.get(order[0]), prev);
  } else {
    const prev = { value: null };
    for (const uid of order) {
      const charName = authorToCharacter.get(uid);
      if (charName) lines.push(`${charName}'s notes:`);
      else lines.push('DM notes:');
      pushEntryLines(groups.get(uid), prev);
    }
  }

  return lines.join('\n');
}

/**
 * Metadata confirming which session journal will be sent to the model.
 * @param {number} sessionId
 * @returns {{ ok: true, sources: object } | { ok: false, status: number, error: string }}
 */
function getRecapSourcesForSession(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return { ok: false, status: 404, error: 'Session not found' };

  const entries = loadSessionJournalEntries(sessionId);
  const { campaignTitle, worldTitle } = resolveSessionScopeTitles(session.folder_id);

  const sessionLabel = session.session_number != null
    ? String(session.session_number)
    : (session.title ? session.title : `id ${session.id}`);

  return {
    ok: true,
    sources: {
      session_id: session.id,
      session_number: session.session_number ?? null,
      session_title: session.title || null,
      session_label: sessionLabel,
      campaign_title: campaignTitle,
      world_title: worldTitle,
      entry_count: entries.length,
      scope: 'session_journal_and_glossary',
    },
  };
}

/**
 * Loads journal data and builds Anthropic prompts for session recap generation.
 * @param {number} sessionId
 * @param {'chronicle'|'summary'} tone
 */
function buildRecapPromptsForSession(sessionId, tone) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return { ok: false, status: 404, error: 'Session not found' };

  const entries = loadSessionJournalEntries(sessionId);

  if (entries.length === 0) {
    return { ok: false, status: 400, error: 'This session has no entries to summarize.' };
  }

  const { campaignTitle, worldTitle, campaignId } = resolveSessionScopeTitles(session.folder_id);

  // Change 1: tagged <session> with real campaign + optional world + session number
  const sessionLines = [
    `Campaign: ${campaignTitle || 'Unknown Campaign'}`,
  ];
  if (worldTitle) sessionLines.push(`World: ${worldTitle}`);
  const sessionValue = session.session_number != null
    ? String(session.session_number)
    : (session.title || `id ${session.id}`);
  sessionLines.push(`Session: ${sessionValue}`);
  const sessionBlock = `<session>\n${sessionLines.join('\n')}\n</session>`;

  // Change 2: <party> from played_by character notes
  const partyBlock = formatPartyBlock(campaignId);

  const authorToCharacter = buildAuthorCharacterMap(campaignId);
  // Change 3–4: authorship grouping, bullets, local date headers, quote tags
  const journalText = formatJournalBlock(entries, authorToCharacter);

  let glossaryBlock = '';
  try {
    if (session.folder_id) {
      const scopeId = getTopLevelScopeForNote(session.folder_id);
      if (scopeId) {
        const { glossary } = ensureGlossaryForScope(scopeId);
        const approved = getApprovedEntriesForRecap(glossary.id, campaignId);
        glossaryBlock = formatGlossaryBlock(approved);
      }
    }
  } catch (e) {
    console.error('[recapPromptBuild] glossary', e.message);
  }

  const fidelityShared = `CRITICAL RULES:
- Story facts come ONLY from the <journal> entries for this one session. Do not invent scenes, outcomes, motives, people, or places that are not in the journal.
- The <glossary> block is a spelling and identity aid only. Use it to preserve names and aliases; do not invent events from it.
- Use spellings from <glossary> and <party>. For names in neither, keep the journal's spelling.
- Do not reassign actions to the wrong person.
- The <party> section lists each player character and who plays them. Usernames are real people, not in-world characters. Never use them in the chronicle.
- If the journal says a character was unaffected or did not do something, keep that.
- Direct quotes must keep their wording and meaning. Theories a character states belong in the recap, attributed to that character.
- When the journal is ambiguous, prefer understating over guessing.
- Do not use em dashes (—) or double hyphens (--) as dash substitutes. Use commas, periods, or plain hyphens sparingly.`;

  const styleExample = loadStyleExample();
  const styleExampleBlock = styleExample
    ? `<style_example>
${styleExample}
</style_example>

This sample shows the voice, pacing, and texture to aim for. Its people, places, and events are not part of this campaign. Never use any of its content.`
    : '';

  const chronicleStyle = `STYLE:
- Open with a scene-setting sentence that places the reader in the moment.
- Vary sentence length. Let important moments land in short sentences.
- Describe places through the journal's own details, made vivid.
- End paragraphs on a resonant line or a sense of what is coming, using only what the journal supports.
- Present prophecies and important spoken words as markdown blockquotes.
- Only italicize quoted speech inside blockquotes or emphasis; do not italicize the whole chronicle.

${styleExampleBlock}`.trim();

  const systemPrompt = tone === 'chronicle'
    ? `You are a skilled scribe chronicling the adventures of a Dungeons & Dragons party. Write in an immersive, in-world narrative style, as if recording events in an official chronicle or historical record. Use past tense, third person. Storytelling voice, scene framing, and paced prose are welcome when dramatizing what the journal actually records. Do not invent facts beyond the journal. Include names, key events, discoveries, conflicts, and decisions that appear in the source. Do not use bullet points. Include every scene in the journal, in order, including small or humorous moments. Length should fit the journal, roughly one paragraph per 2-4 scenes.

Begin with a subtitle line in the form '## <subtitle>'. The subtitle names the session's main events or themes in 3 to 8 evocative words, using only places, people, and events from the journal (for example '## The Golden Orchard and Whispered Fates'). Do not write any other title, heading, date line, or byline. The app adds the main title separately.

${fidelityShared}

${chronicleStyle}`
    : `You are summarizing a Dungeons & Dragons session for the players. Be clear, factual, and organized. Highlight: what happened, key NPCs encountered, decisions made, and any unresolved threads — only when present in the journal. Use bullet points where helpful. Keep it concise — 200-350 words. Cover every scene briefly, even if only in a clause. Prefer understatement when details are thin.

Optionally begin with a subtitle line in the form '## <subtitle>' (3 to 8 words from the journal). Do not write any other title, heading, date line, or byline. The app adds the main title separately.

${fidelityShared}`;

  const closing = tone === 'chronicle'
    ? 'Write the chronicle entry for this session. Start with the ## subtitle line.'
    : 'Write the session summary for this session.';

  // Order: session → party → glossary → journal (no Source-material line)
  const parts = [sessionBlock, partyBlock];
  if (glossaryBlock) parts.push(glossaryBlock);
  parts.push(`<journal>\n${journalText}\n</journal>`);
  parts.push(closing);
  const userPrompt = parts.filter(Boolean).join('\n\n');

  const sources = {
    session_id: session.id,
    session_number: session.session_number ?? null,
    session_title: session.title || null,
    session_label: session.session_number != null
      ? String(session.session_number)
      : (session.title || `id ${session.id}`),
    campaign_title: campaignTitle,
    world_title: worldTitle,
    entry_count: entries.length,
    scope: 'session_journal_and_glossary',
  };

  const temperature = tone === 'chronicle' ? 0.4 : 0;

  return {
    ok: true,
    session,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    sources,
    temperature,
  };
}

module.exports = {
  buildRecapPromptsForSession,
  getRecapSourcesForSession,
  parseModelRecapOutput,
  assembleRecapMarkdown,
  formatJournalBlock,
  speakerFromPreviousLine,
  maybeWrapQuote,
  localDayParts,
  getAppTimezone,
};
