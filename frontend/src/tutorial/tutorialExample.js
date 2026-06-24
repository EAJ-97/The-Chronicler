/**
 * Resolves live demo note-link snippets for tutorial card examples.
 */

/**
 * Finds a demo note by exact title (case-insensitive).
 * @param {Array<{ id: number, title?: string, is_demo?: number, content?: string }>} allNotes
 * @param {string} title
 * @returns {object|null}
 */
export function findDemoNoteByTitle(allNotes, title) {
  const want = String(title || '').trim().toLowerCase();
  if (!want) return null;
  return (
    (allNotes || []).find(
      (n) => Number(n.is_demo) === 1 && String(n.title || '').trim().toLowerCase() === want,
    ) || null
  );
}

/**
 * Pulls the first markdown line containing a `note:` link from note content.
 * @param {string} [content]
 * @returns {string|null}
 */
export function extractFirstNoteLinkLine(content) {
  if (!content) return null;
  const lines = String(content).split('\n');
  for (const line of lines) {
    if (/\[([^\]]+)\]\(note:\d+\)/i.test(line)) return line.trim();
  }
  return null;
}

/**
 * Builds tutorial card copy for the note-link step from live demo data.
 * @param {Array<object>} notes
 * @returns {string|null}
 */
export function buildNoteLinkTutorialExample(notes) {
  const veldrath = findDemoNoteByTitle(notes, 'Veldrath City');
  const line = extractFirstNoteLinkLine(veldrath?.content);
  if (!line) {
    return '_Refresh the page after the server restarts to load the demo note-link example._';
  }
  return `From the **Veldrath City** location note:\n\n${line}\n\nIn preview, click the link to open the side peek reader.`;
}
