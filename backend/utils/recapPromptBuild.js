const db = require('../db/database');
const { getRootFolderId } = require('./access');

/**
 * Loads journal data and builds Anthropic prompts for session recap generation.
 * @param {number} sessionId
 * @param {'chronicle'|'summary'} tone
 * @returns {{ ok: true, session: object, system_prompt: string, user_prompt: string } | { ok: false, status: number, error: string }}
 */
function buildRecapPromptsForSession(sessionId, tone) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return { ok: false, status: 404, error: 'Session not found' };

  const entries = db.prepare(`
    SELECT je.content, je.indent_level, u.username as author
    FROM journal_entries je
    JOIN users u ON u.id = je.user_id
    WHERE je.session_id = ? AND je.is_session_break = 0
    ORDER BY je.sort_order ASC, je.id ASC
  `).all(sessionId);

  if (entries.length === 0) {
    return { ok: false, status: 400, error: 'This session has no entries to summarize.' };
  }

  const campaignFolder = session.folder_id
    ? db.prepare('SELECT title FROM notes WHERE id = ?').get(getRootFolderId(session.folder_id))
    : null;

  const journalText = entries.map((e) => {
    const indent = '  '.repeat(e.indent_level || 0);
    return `${indent}[${e.author}]: ${e.content}`;
  }).join('\n');

  const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE folder_id = ?').get(session.folder_id)?.c || 1;

  const systemPrompt = tone === 'chronicle'
    ? `You are a skilled scribe chronicling the adventures of a Dungeons & Dragons party. Write in an immersive, in-world narrative style — as if recording events in an official chronicle or historical record. Use past tense, third person. Include names, key events, discoveries, conflicts, and decisions. Be vivid but concise. Do not use bullet points. Write 2-4 paragraphs.`
    : `You are summarizing a Dungeons & Dragons session for the players. Be clear, factual, and organized. Highlight: what happened, key NPCs encountered, decisions made, and any unresolved threads. Use bullet points where helpful. Keep it concise — 200-350 words.`;

  const userPrompt = `Campaign: ${campaignFolder?.title || 'Unknown Campaign'}
Session Number: ${sessionCount}

Journal entries from this session:
${journalText}

Please write a ${tone === 'chronicle' ? 'narrative chronicle entry' : 'session summary'} for this session.`;

  return {
    ok: true,
    session,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
  };
}

module.exports = { buildRecapPromptsForSession };
