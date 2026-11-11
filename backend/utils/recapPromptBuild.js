const db = require('../db/database');
const { getRootFolderId, getCampaignFolderId } = require('./access');
const {
  ensureGlossaryForScope,
  getTopLevelScopeForNote,
  getApprovedEntriesForRecap,
  formatGlossaryBlock,
} = require('./glossary');

/**
 * Journal entries for one session (recap source of truth).
 * @param {number} sessionId
 * @returns {Array<{ content: string, indent_level: number, author: string }>}
 */
function loadSessionJournalEntries(sessionId) {
  return db.prepare(`
    SELECT je.content, je.indent_level, u.username as author
    FROM journal_entries je
    JOIN users u ON u.id = je.user_id
    WHERE je.session_id = ? AND je.is_session_break = 0
    ORDER BY je.sort_order ASC, je.id ASC
  `).all(sessionId);
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
  const campaignFolder = session.folder_id
    ? db.prepare('SELECT title FROM notes WHERE id = ?').get(getRootFolderId(session.folder_id))
    : null;

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
      campaign_title: campaignFolder?.title || null,
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

  const campaignFolder = session.folder_id
    ? db.prepare('SELECT title FROM notes WHERE id = ?').get(getRootFolderId(session.folder_id))
    : null;

  const journalText = entries.map((e) => {
    const indent = '  '.repeat(e.indent_level || 0);
    return `${indent}[Player: ${e.author}]: ${e.content}`;
  }).join('\n');

  const sessionNumberLine = session.session_number != null
    ? `Session Number: ${session.session_number}`
    : (session.title
      ? `Session Title: ${session.title}`
      : `Session Id: ${session.id}`);

  const sessionTitleLine = session.title && session.session_number != null
    ? `Session Title: ${session.title}\n`
    : '';

  // Approved glossary for spelling / identity (not a source of new events)
  let glossaryBlock = '';
  try {
    if (session.folder_id) {
      const scopeId = getTopLevelScopeForNote(session.folder_id);
      if (scopeId) {
        const { glossary } = ensureGlossaryForScope(scopeId);
        const campaignId = getCampaignFolderId(session.folder_id);
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
- Preserve exact spelling of every name as written in the journal and glossary. Do not "correct" or rename.
- Do not reassign actions to the wrong person.
- Labels like [Player: username] are player account names, not in-world character names. Prefer character names when the journal states them; otherwise describe actions without inventing a character name.
- When the journal is ambiguous, prefer understating over guessing.`;

  const systemPrompt = tone === 'chronicle'
    ? `You are a skilled scribe chronicling the adventures of a Dungeons & Dragons party. Write in an immersive, in-world narrative style — as if recording events in an official chronicle or historical record. Use past tense, third person. Storytelling voice, scene framing, and paced prose are welcome when dramatizing what the journal actually records. Do not invent facts beyond the journal. Include names, key events, discoveries, conflicts, and decisions that appear in the source. Be vivid but concise. Do not use bullet points. Write 2-4 paragraphs.

${fidelityShared}`
    : `You are summarizing a Dungeons & Dragons session for the players. Be clear, factual, and organized. Highlight: what happened, key NPCs encountered, decisions made, and any unresolved threads — only when present in the journal. Use bullet points where helpful. Keep it concise — 200-350 words. Prefer understatement when details are thin.

${fidelityShared}`;

  const closing = tone === 'chronicle'
    ? 'Write the chronicle entry for this session.'
    : 'Write the session summary for this session.';

  const userPrompt = `Campaign: ${campaignFolder?.title || 'Unknown Campaign'}
${sessionNumberLine}
${sessionTitleLine}${glossaryBlock ? `${glossaryBlock}\n\n` : ''}<journal>
${journalText}
</journal>

${closing}`;

  const sources = {
    session_id: session.id,
    session_number: session.session_number ?? null,
    session_title: session.title || null,
    session_label: session.session_number != null
      ? String(session.session_number)
      : (session.title || `id ${session.id}`),
    campaign_title: campaignFolder?.title || null,
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

module.exports = { buildRecapPromptsForSession, getRecapSourcesForSession };
