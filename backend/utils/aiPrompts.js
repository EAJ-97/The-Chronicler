/**
 * System and user prompt strings for Anthropic AI tools (lore, NPC gen, continuity).
 */

/**
 * Lore So Far — player-safe summary from provided corpus only.
 */
function loreSoFarPrompts(corpusText, campaignTitle) {
  const system = `You are a lore assistant for a Dungeons & Dragons campaign. You ONLY use the provided source material. Do not invent facts. If something is unknown from the sources, say so briefly. Output clear markdown with sections: Overview, Key Characters & Factions, Timeline / Events (as far as the sources show), Open Threads & Mysteries, and (optional) Connections between notes when the sources show relationships. Keep a consistent tone suitable for players.`;

  const user = `Campaign: ${campaignTitle || 'Campaign'}

Source material (notes, journal, connections — only what the player may see):

${corpusText}

Write "Lore So Far" as markdown for the players.`;

  return { system, user };
}

/**
 * Appends optional attachment context (linked notes) to the user message.
 * @param {string} base
 * @param {string} [attachmentContext]
 */
function appendAttachmentBlock(base, attachmentContext) {
  const att = (attachmentContext || '').trim();
  if (!att) return base;
  return `${base}\n\n---\n\n${att}`;
}

/**
 * NPC Generator — structured markdown note body; NPC/character content only (not locations or items).
 */
function npcGeneratorPrompts(userPrompt, opts = {}) {
  const dmOnly = !!opts.dm_only;
  const attachmentContext = opts.attachmentContext || '';
  const system = `You write Dungeons & Dragons NPC or character notes in markdown ONLY. Do not output a location write-up, dungeon map, or magic item as the main subject. Stay focused on people and creatures as characters: voice, motives, relationships, and roleplay hooks.

Use headings: # Name, ## Overview, ## Appearance, ## Personality, ## Goals & Motives, ## Secrets, ## Plot Hooks, ## Relationships. Stat blocks only if the user asks. ${
    dmOnly
      ? 'Include a final section ## DM Notes with information players should not see.'
      : 'Do not include a DM-only section.'
  }

If "Notes linked from your prompt" are provided, tie the NPC to those sources when relevant; do not contradict them.`;

  const user = appendAttachmentBlock(
    `Create ONLY an NPC / character note from this direction (not a place or object):\n\n${userPrompt || 'A memorable NPC appropriate for the campaign.'}`,
    attachmentContext
  );

  return { system, user };
}

/**
 * Location Generator — place-only; no NPC statblocks or item write-ups as primary output.
 */
function locationGeneratorPrompts(userPrompt, opts = {}) {
  const dmOnly = !!opts.dm_only;
  const attachmentContext = opts.attachmentContext || '';
  const system = `You write Dungeons & Dragons location notes in markdown ONLY: settlements, buildings, wilderness sites, dungeons, planar locales. Do not make the primary output an NPC profile or a magic item; at most briefly name inhabitants or treasure if the user asks.

Use headings: # Name, ## Summary, ## Geography & Layout, ## Atmosphere & Sensory, ## Hazards & Defenses, ## Secrets & Lore, ## Plot Hooks, ## Connections. ${
    dmOnly ? 'Include ## DM Notes for hidden information.' : 'No DM-only section.'
  }

If linked notes are provided, ground the location in that canon when it fits.`;

  const user = appendAttachmentBlock(
    `Create ONLY a location / place note from this direction:\n\n${userPrompt || 'A memorable location for the campaign.'}`,
    attachmentContext
  );

  return { system, user };
}

/**
 * Item / artifact Generator — object-only.
 */
function itemGeneratorPrompts(userPrompt, opts = {}) {
  const dmOnly = !!opts.dm_only;
  const attachmentContext = opts.attachmentContext || '';
  const system = `You write Dungeons & Dragons item and artifact notes in markdown ONLY: weapons, armor, wondrous items, relics, consumables, vehicles as objects. Do not write a full NPC profile or location gazetteer as the main document; you may name who owned the item in a short line if relevant.

Use headings: # Name, ## Summary, ## Appearance, ## Properties & Mechanics, ## History & Origin, ## Curses / Drawbacks (if any), ## Plot Hooks, ## Attunement (if applicable). ${
    dmOnly ? 'Include ## DM Notes for hidden properties.' : 'No DM-only section.'
  }

If linked notes are provided, connect the item to that material when appropriate.`;

  const user = appendAttachmentBlock(
    `Create ONLY an item / artifact note from this direction:\n\n${userPrompt || 'A memorable item for the campaign.'}`,
    attachmentContext
  );

  return { system, user };
}

/**
 * Continuity checker — DM-only analysis.
 */
function continuityPrompts(corpusText, folderTitle) {
  const system = `You are a continuity editor for a D&D campaign. Analyze ONLY the provided material. Identify: contradictions, timeline issues, unresolved plot threads, missing motivations, name/location inconsistencies, and suggested fixes. Output markdown with clear headings. Cite note ids in brackets like [note:123] when referring to specific notes. Do not invent facts beyond reasonable inference from gaps.`;

  const user = `Folder / campaign context: ${folderTitle || 'Campaign'}

Campaign material:

${corpusText}

Produce a continuity report.`;

  return { system, user };
}

/**
 * Per-note player-facing lore summary (used when campaign/world is marked completed).
 * @param {string} title
 * @param {string} bodyText - visible note body only (callers strip DM-only when needed).
 */
function playerLoreSummaryPrompts(title, bodyText) {
  const system = `You write short, clear summaries for tabletop RPG players. Only use the provided note text. Do not invent facts. If the text is sparse, say so briefly.`;

  const user = `Note title: ${title || 'Untitled'}

Note content:
${bodyText || '(empty)'}

Give a concise 3–5 sentence summary for a player who wants to recall this lore. No spoilers beyond what is in the text.`;

  return { system, user };
}

module.exports = {
  loreSoFarPrompts,
  npcGeneratorPrompts,
  locationGeneratorPrompts,
  itemGeneratorPrompts,
  continuityPrompts,
  playerLoreSummaryPrompts,
};
