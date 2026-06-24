/** D&D Beyond alignmentId → label. */
const ALIGNMENT_BY_ID = {
  1: 'Lawful Good',
  2: 'Neutral Good',
  3: 'Chaotic Good',
  4: 'Lawful Neutral',
  5: 'Neutral',
  6: 'Chaotic Neutral',
  7: 'Lawful Evil',
  8: 'Neutral Evil',
  9: 'Chaotic Evil',
};

/** D&D Beyond sizeId → label. */
const SIZE_BY_ID = {
  1: 'Tiny',
  2: 'Small',
  3: 'Medium',
  4: 'Large',
  5: 'Huge',
  6: 'Gargantuan',
};

/**
 * Strips HTML tags for markdown-safe plain text snippets (single-line friendly fields).
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * Converts DDB HTML flavor fields to markdown paragraphs (preserves blank lines between blocks).
 * Handles: two adjacent <p> tags → paragraph break; <br> within a paragraph → line break.
 * @param {string} html
 * @returns {string}
 */
function htmlToFlavorText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Returns the first non-empty trimmed string from candidate values.
 * @param {...unknown} values
 * @returns {string}
 */
function pickText(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = stripHtml(String(v)).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Returns the first non-empty flavor text from candidates (paragraph-aware HTML conversion).
 * @param {...unknown} values
 * @returns {string}
 */
function pickFlavorText(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = htmlToFlavorText(String(v)).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Normalizes DDB trait/notes fields that may be string or array (backstory, allies, traits, etc.).
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTraitText(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null) return '';
        if (typeof entry === 'string') return htmlToFlavorText(entry);
        return pickFlavorText(entry.text, entry.value, entry.description, entry.name);
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof value === 'string') return htmlToFlavorText(value);
  return pickFlavorText(value);
}

/**
 * Builds a readable class + subclass summary from DDB class rows.
 * @param {Array<object>|undefined} classes
 * @returns {string}
 */
function formatClasses(classes) {
  if (!Array.isArray(classes) || classes.length === 0) return '';
  return classes
    .map((c) => {
      const className = c.definition?.name || c.className || c.name || 'Class';
      const subclass = c.subclassDefinition?.name || c.subclassName || '';
      return subclass ? `${className} (${subclass})` : className;
    })
    .join(' / ');
}

/**
 * Resolves the background name shown on the character sheet (variant/custom when present).
 * @param {object} data
 * @returns {string}
 */
function resolveBackgroundName(data) {
  const bg = data.background || {};
  const custom = bg.customBackground || {};
  const customDef = custom.definition || custom.featuresBackground?.definition || {};

  return pickText(
    bg.option,
    custom.name,
    customDef.name,
    bg.definition?.name,
    data.backgroundName,
  );
}

/**
 * Reads the background feature name and description from sheet data (not the full creation blurb).
 * @param {object} data
 * @returns {{ name: string, description: string }}
 */
function readBackgroundFeature(data) {
  const bg = data.background || {};
  const custom = bg.customBackground || {};
  const customDef = custom.definition || custom.featuresBackground?.definition || {};
  const bgDef = Object.keys(customDef).length > 0 ? customDef : (bg.definition || {});

  const name = pickText(bgDef.featureName);
  const description = pickFlavorText(
    bgDef.featureDescription,
    bgDef.featureSnippet,
    bgDef.snippet,
  );

  if (name || description) {
    return { name, description };
  }

  const fromFeatures = (data.features || []).find((f) => {
    const type = String(f.type || f.definition?.type || '').toLowerCase();
    const source = String(f.source || f.definition?.source || '').toLowerCase();
    return type.includes('background') || source.includes('background');
  });
  if (fromFeatures) {
    return {
      name: pickText(fromFeatures.definition?.name, fromFeatures.name),
      description: pickFlavorText(fromFeatures.definition?.snippet, fromFeatures.definition?.description),
    };
  }

  return { name: '', description: '' };
}

/**
 * Reads alignment label from character sheet fields.
 * @param {object} data
 * @returns {string}
 */
function readAlignment(data) {
  return pickText(
    data.alignment?.name,
    data.alignmentName,
    ALIGNMENT_BY_ID[data.alignmentId],
  );
}

/**
 * Reads creature size from explicit fields or racial traits.
 * @param {object} data
 * @returns {string}
 */
function readSize(data) {
  const direct = pickText(data.size, data.sizeName);
  if (direct) return direct;

  const sizeId = data.sizeId ?? data.race?.sizeId;
  if (sizeId && SIZE_BY_ID[sizeId]) return SIZE_BY_ID[sizeId];

  const traits = data.race?.racialTraits || [];
  for (const trait of traits) {
    const desc = trait.definition?.description || trait.definition?.snippet || '';
    const match = String(desc).match(/Your size is (\w+)/i);
    if (match) return match[1];
  }

  return '';
}

/**
 * Reads personality/appearance fields from the character sheet traits block.
 * @param {object} data
 * @returns {{ personalityTraits: string, ideals: string, bonds: string, flaws: string, appearance: string }}
 */
function readSheetTraits(data) {
  const traits = data.traits || {};
  return {
    personalityTraits: normalizeTraitText(traits.personalityTraits ?? data.personalityTraits),
    ideals: normalizeTraitText(traits.ideals ?? data.ideals),
    bonds: normalizeTraitText(traits.bonds ?? data.bonds),
    flaws: normalizeTraitText(traits.flaws ?? data.flaws),
    appearance: normalizeTraitText(traits.appearance ?? data.appearance),
  };
}

/**
 * Builds labeled characteristic lines matching the DDB character sheet background tab.
 * @param {object} data
 * @returns {string[]}
 */
function collectCharacteristics(data) {
  const rows = [
    ['Alignment', readAlignment(data)],
    ['Gender', pickText(data.gender)],
    ['Eyes', pickText(data.eyes)],
    ['Size', readSize(data)],
    ['Height', pickText(data.height)],
    ['Faith', pickText(data.faith)],
    ['Hair', pickText(data.hair)],
    ['Skin', pickText(data.skin)],
    ['Age', pickText(data.age)],
    ['Weight', pickText(data.weight)],
  ];

  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `**${label}:** ${value}`);
}

/**
 * Collects background-tab content from character sheet fields (not creation boilerplate).
 * @param {object} data
 * @returns {string[]}
 */
function collectBackgroundSections(data) {
  const sections = [];
  const backgroundName = resolveBackgroundName(data);
  const feature = readBackgroundFeature(data);
  const characteristics = collectCharacteristics(data);
  const sheetTraits = readSheetTraits(data);

  if (backgroundName) sections.push(`### Background\n\n${backgroundName}`);

  if (feature.name || feature.description) {
    const featureTitle = feature.name ? `**Feature: ${feature.name}**` : '**Feature**';
    sections.push([featureTitle, feature.description].filter(Boolean).join('\n\n'));
  }

  if (characteristics.length) {
    sections.push(`### Characteristics\n\n${characteristics.join('\n')}`);
  }

  if (sheetTraits.personalityTraits) {
    sections.push(`### Personality Traits\n\n${sheetTraits.personalityTraits}`);
  }
  if (sheetTraits.ideals) {
    sections.push(`### Ideals\n\n${sheetTraits.ideals}`);
  }
  if (sheetTraits.bonds) {
    sections.push(`### Bonds\n\n${sheetTraits.bonds}`);
  }
  if (sheetTraits.flaws) {
    sections.push(`### Flaws\n\n${sheetTraits.flaws}`);
  }
  if (sheetTraits.appearance) {
    sections.push(`### Appearance\n\n${sheetTraits.appearance}`);
  }

  return sections;
}

/**
 * Reads a single notes-tab field from data.notes with optional top-level fallback.
 * @param {object} data
 * @param {string} key
 * @returns {string}
 */
function readNotesField(data, key) {
  const notes = data.notes || {};
  return normalizeTraitText(notes[key] ?? data[key]);
}

/**
 * Collects Notes-tab content from the character sheet (allies, organizations, etc.; backstory excluded).
 * @param {object} data
 * @returns {string[]}
 */
function collectNotesSections(data) {
  const noteFields = [
    ['Allies', readNotesField(data, 'allies')],
    ['Organizations', readNotesField(data, 'organizations')],
    ['Enemies', readNotesField(data, 'enemies')],
    ['Possessions', readNotesField(data, 'personalPossessions')],
    ['Other Notes', readNotesField(data, 'otherNotes')],
  ];

  return noteFields
    .filter(([, value]) => value)
    .map(([label, value]) => `### ${label}\n\n${value}`);
}

/**
 * Escapes alt text for markdown image syntax.
 * @param {string} name
 * @returns {string}
 */
function portraitAltText(name) {
  return String(name || 'Character').replace(/[\[\]]/g, '');
}

/**
 * Converts D&D Beyond v5 character JSON to a slim Chronicler note (name, class, backstory, description, notes).
 * @param {object} data - Raw character.data from character-service
 * @param {{ portraitUrl?: string|null }} [options] - Optional managed `/api/images/files/*` URL inserted under the name
 * @returns {{ title: string, content: string, tags: string[] }}
 */
function characterToMarkdown(data, options = {}) {
  const id = data.id ?? data.characterId;
  const name = data.name || 'Unnamed Character';
  const classSummary = formatClasses(data.classes);
  const backstory = readNotesField(data, 'backstory');
  const backgroundSections = collectBackgroundSections(data);
  const notesSections = collectNotesSections(data);
  const portraitUrl = options.portraitUrl ? String(options.portraitUrl).trim() : '';

  const sections = [`# ${name}`];
  if (portraitUrl) {
    sections.push(`![${portraitAltText(name)}](${portraitUrl})`);
  }
  if (classSummary) sections.push(`**Class:** ${classSummary}`);
  if (backstory) sections.push(`## Backstory\n\n${backstory}`);
  if (backgroundSections.length) {
    sections.push(`## Description\n\n${backgroundSections.join('\n\n')}`);
  }
  if (notesSections.length) {
    sections.push(`## Notes\n\n${notesSections.join('\n\n')}`);
  }
  sections.push(`<!-- ddb-character-id: ${id} -->`);

  const tags = ['dnd-beyond', 'import'];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug) tags.push(slug);

  return {
    title: name,
    content: sections.join('\n\n'),
    tags,
  };
}

/**
 * Stable string used for flavor sync hashing (content body only, normalized).
 * @param {string} content - Full note markdown from characterToMarkdown
 * @returns {string}
 */
function flavorHashInput(content) {
  return String(content || '').replace(/\r\n/g, '\n').trim();
}

module.exports = {
  characterToMarkdown,
  htmlToFlavorText,
  flavorHashInput,
};
