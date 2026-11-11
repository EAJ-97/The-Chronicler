/**
 * Chronicle generation: extract (scenes JSON) → write (prose) → verify (+ one revision).
 */
const {
  getRecapExtractModel,
  getRecapWriteModel,
  getRecapVerifyModel,
  modelSupportsTemperature,
  extractAssistantText,
} = require('./aiModels');
const {
  loadRecapSessionContext,
  buildStyleExampleBlock,
  parseModelRecapOutput,
} = require('./recapPromptBuild');
const { parseJsonFromModelText } = require('./glossaryScan');

const VERIFY_PROBLEM_TYPES = new Set([
  'missing_key_fact',
  'invented_plot',
  'wrong_attribution',
  'altered_quote',
]);

function isRecapDebug() {
  return ['1', 'true', 'yes'].includes(String(process.env.RECAP_DEBUG || '').trim().toLowerCase());
}

/**
 * @param {string} step
 * @param {string} label
 * @param {string} text
 */
function debugLog(step, label, text) {
  if (!isRecapDebug()) return;
  console.log(`[recap/debug] ${step} ${label}\n`, text);
}

/**
 * Call Anthropic Messages API once.
 * @param {{ apiKey: string, model: string, system: string, user: string, maxTokens?: number, temperature?: number, step: string }} opts
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
async function callAnthropic(opts) {
  const {
    apiKey,
    model,
    system,
    user,
    maxTokens = 4096,
    temperature,
    step,
  } = opts;

  debugLog(step, 'system', system);
  debugLog(step, 'user', user);

  const reqBody = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (modelSupportsTemperature(model) && temperature != null) {
    reqBody.temperature = temperature;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || 'Anthropic API error';
    console.error(`[recap/${step}] API error`, msg);
    return { ok: false, error: msg };
  }

  const data = await response.json();
  const text = extractAssistantText(data);
  debugLog(step, 'output', text || '(empty)');

  if (!text) {
    const types = Array.isArray(data.content) ? data.content.map((c) => c.type).join(',') : 'none';
    console.error(`[recap/${step}] empty text`, `stop=${data.stop_reason || '?'} blocks=[${types}]`);
    return { ok: false, error: 'Empty response from AI' };
  }

  return { ok: true, text };
}

/**
 * @param {unknown} data
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateExtractPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'extract root must be an object' };
  }

  const ideasRaw = data.subtitle_ideas;
  if (!Array.isArray(ideasRaw)) return { ok: false, error: 'subtitle_ideas must be an array' };
  const subtitle_ideas = ideasRaw
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (subtitle_ideas.length < 1) {
    return { ok: false, error: 'subtitle_ideas needs at least one string' };
  }

  const scenesRaw = data.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length < 1) {
    return { ok: false, error: 'scenes must be a non-empty array' };
  }

  const scenes = [];
  for (let i = 0; i < scenesRaw.length; i += 1) {
    const s = scenesRaw[i];
    if (!s || typeof s !== 'object') {
      return { ok: false, error: `scenes[${i}] must be an object` };
    }
    const location = String(s.location || '').trim();
    const characters = Array.isArray(s.characters)
      ? s.characters.map((c) => String(c || '').trim()).filter(Boolean)
      : null;
    const key_facts = Array.isArray(s.key_facts)
      ? s.key_facts.map((f) => String(f || '').trim()).filter(Boolean)
      : null;
    const details = Array.isArray(s.details)
      ? s.details.map((d) => String(d || '').trim()).filter(Boolean)
      : null;
    if (!characters || !key_facts || !details) {
      return { ok: false, error: `scenes[${i}] needs characters, key_facts, and details arrays` };
    }
    if (!Array.isArray(s.quotes)) {
      return { ok: false, error: `scenes[${i}].quotes must be an array` };
    }
    const quotes = [];
    for (let j = 0; j < s.quotes.length; j += 1) {
      const q = s.quotes[j];
      if (!q || typeof q !== 'object') {
        return { ok: false, error: `scenes[${i}].quotes[${j}] must be an object` };
      }
      const text = String(q.text || '').trim();
      if (!text) continue;
      quotes.push({
        speaker: String(q.speaker || '').trim(),
        to: String(q.to || '').trim(),
        text,
      });
    }
    scenes.push({
      location,
      characters,
      key_facts,
      details,
      quotes,
    });
  }

  return {
    ok: true,
    value: {
      subtitle_ideas: subtitle_ideas.slice(0, 8),
      scenes,
    },
  };
}

/**
 * @param {unknown} data
 * @returns {{ ok: true, value: { problems: Array<{ type: string, detail: string }> } } | { ok: false, error: string }}
 */
function validateVerifyPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'verify root must be an object' };
  }
  if (!Array.isArray(data.problems)) {
    return { ok: false, error: 'problems must be an array' };
  }
  const problems = [];
  for (const p of data.problems) {
    if (!p || typeof p !== 'object') continue;
    const type = String(p.type || '').trim();
    const detail = String(p.detail || '').trim();
    if (!VERIFY_PROBLEM_TYPES.has(type)) continue;
    if (!detail) continue;
    problems.push({ type, detail });
  }
  return { ok: true, value: { problems } };
}

const EXTRACT_SYSTEM = `You extract structured scene notes from a D&D session journal for a chronicler.

Return JSON only (no markdown fences, no commentary) with this exact shape:
{
  "subtitle_ideas": ["short string", "short string", "short string"],
  "scenes": [
    {
      "location": "",
      "characters": [],
      "key_facts": [],
      "details": [],
      "quotes": [ { "speaker": "", "to": "", "text": "" } ]
    }
  ]
}

Rules:
- Produce exactly three subtitle_ideas (3 to 8 words each) naming the session's main events or themes.
- Split the journal into ordered scenes. Every journal line must land in some scene (as a key_fact, detail, or quote).
- key_facts: events, decisions, items gained, revelations, who did what, and anything stated as NOT happening (e.g. "Calder slept peacefully").
- details: descriptive or minor facts (decor, prices, appearance).
- quotes: copy dialogue word for word. Set speaker and to (addressee) when known; use "" if unknown.
- Use spellings from <glossary> and <party>. For names in neither, keep the journal spelling.
- Usernames in <party> are real people, not in-world characters — never put them in scenes.
- Do not invent people, places, items, events, or quotes absent from the journal.`;

const WRITE_SYSTEM = `You are the royal chronicler of Valomyr, recording the deeds of a band of adventurers in the high, vivid style of a fantasy saga. Past tense, third person.

You are given a list of scenes and facts. They are notes, not prose: never reuse their wording. Tell the story in your own voice.

Every scene and every key_fact must appear. Details may be woven in, compressed into a single image, or used as texture; they do not each need a sentence.

YOU MAY INVENT FREELY: weather, light, sound, smell, texture, the bustle of crowds, the feel of a place, small gestures and expressions, visible reactions that fit the moment (a long silence, a hand tightening on a hilt), metaphors, similes, and transitions between scenes.

YOU MUST NEVER INVENT: named people, places, or items not in the facts; events or outcomes; lines of dialogue; decisions; motives or backstory; answers to mysteries the facts leave open. Never change who did what. Never alter quote wording.

Shape each scene: open with the senses, let the facts unfold inside the scene, and close on a resonant line. Vary sentence length. Give prophecies room: set them as markdown blockquotes and let the moment after them breathe.

Begin with "## <subtitle>" (choose from or improve on subtitle_ideas, 3 to 8 words), then a blank line, then the chronicle. No other headings, dates, or bylines. Never mention notes, journals, players, or sessions.

Do not use em dashes (—) or double hyphens (--) as dash substitutes. Use commas, periods, or plain hyphens sparingly.`;

const VERIFY_SYSTEM = `You verify a fantasy chronicle against structured scene notes.

Return JSON only (no markdown fences, no commentary):
{ "problems": [ { "type": "missing_key_fact" | "invented_plot" | "wrong_attribution" | "altered_quote", "detail": "" } ] }

Flag only:
- missing_key_fact: a key_fact from the scenes is absent from the chronicle
- invented_plot: the chronicle adds named people, places, items, events, outcomes, decisions, motives, backstory, or answers the notes leave open
- wrong_attribution: who did what does not match the notes
- altered_quote: dialogue wording was changed from the notes

ALLOWED and must NOT be flagged: invented atmosphere, sensory detail (weather, light, sound, smell, texture), gestures, visible reactions, metaphors, similes, and scene transitions.

If nothing is wrong, return { "problems": [] }.`;

/**
 * Run one extract attempt.
 * @param {string} apiKey
 * @param {string} payloadBlocks
 * @returns {Promise<{ ok: true, scenes: object } | { ok: false, error: string }>}
 */
async function runExtractOnce(apiKey, payloadBlocks) {
  const user = `${payloadBlocks}\n\nReturn the JSON object only.`;
  const call = await callAnthropic({
    apiKey,
    model: getRecapExtractModel(),
    system: EXTRACT_SYSTEM,
    user,
    maxTokens: 4096,
    temperature: 0,
    step: 'extract',
  });
  if (!call.ok) return call;

  let parsed;
  try {
    parsed = parseJsonFromModelText(call.text);
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid JSON from extract' };
  }
  const validated = validateExtractPayload(parsed);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, scenes: validated.value };
}

/**
 * @param {string} apiKey
 * @param {object} scenes
 * @param {string} partyBlock
 * @param {string} [priorDraft]
 * @param {Array<{ type: string, detail: string }>} [problems]
 * @returns {Promise<{ ok: true, raw: string } | { ok: false, error: string }>}
 */
async function runWrite(apiKey, scenes, partyBlock, priorDraft, problems) {
  const styleBlock = buildStyleExampleBlock();
  const scenesJson = JSON.stringify(scenes, null, 2);
  const parts = [
    `<scenes>\n${scenesJson}\n</scenes>`,
    partyBlock || '<party>\n</party>',
  ];
  if (styleBlock) parts.push(styleBlock);

  if (priorDraft && problems && problems.length) {
    parts.push(`<draft>\n${priorDraft}\n</draft>`);
    parts.push(`<problems>\n${JSON.stringify(problems, null, 2)}\n</problems>`);
    parts.push('Fix only these problems. Keep everything else, including the style, unchanged. Return the full corrected chronicle starting with ## subtitle.');
  } else {
    parts.push('Write the chronicle from the scenes. Start with the ## subtitle line. Do not use the raw journal; only the scenes and party list.');
  }

  const call = await callAnthropic({
    apiKey,
    model: getRecapWriteModel(),
    system: WRITE_SYSTEM,
    user: parts.join('\n\n'),
    maxTokens: 4096,
    temperature: 0.4,
    step: priorDraft ? 'write-revise' : 'write',
  });
  if (!call.ok) return call;
  return { ok: true, raw: call.text };
}

/**
 * @param {string} apiKey
 * @param {object} scenes
 * @param {string} chronicleRaw
 * @returns {Promise<{ problems: Array<{ type: string, detail: string }>, verify_parse_ok: boolean }>}
 */
async function runVerify(apiKey, scenes, chronicleRaw) {
  const user = `<scenes>\n${JSON.stringify(scenes, null, 2)}\n</scenes>\n\n<chronicle>\n${chronicleRaw}\n</chronicle>\n\nReturn the JSON object only.`;

  const attempt = async () => {
    const call = await callAnthropic({
      apiKey,
      model: getRecapVerifyModel(),
      system: VERIFY_SYSTEM,
      user,
      maxTokens: 4096,
      temperature: 0,
      step: 'verify',
    });
    if (!call.ok) return { ok: false, error: call.error };
    let parsed;
    try {
      parsed = parseJsonFromModelText(call.text);
    } catch (e) {
      return { ok: false, error: e.message || 'Invalid JSON from verify' };
    }
    const validated = validateVerifyPayload(parsed);
    if (!validated.ok) return { ok: false, error: validated.error };
    return { ok: true, value: validated.value };
  };

  let result = await attempt();
  if (!result.ok) {
    console.error('[recap/verify] parse/API fail, retrying once:', result.error);
    result = await attempt();
  }
  if (!result.ok) {
    console.error('[recap/verify] giving up; treating as no problems:', result.error);
    return { problems: [], verify_parse_ok: false };
  }
  return { problems: result.value.problems, verify_parse_ok: true };
}

/**
 * Full chronicle pipeline for one session.
 * @param {number} sessionId
 * @param {string} apiKey
 * @returns {Promise<
 *   | { ok: true, session: object, sources: object, raw: string, subtitle: string|null, body: string, verify_report: object }
 *   | { ok: false, status: number, error: string }
 * >}
 */
async function runChroniclePipeline(sessionId, apiKey) {
  const ctx = loadRecapSessionContext(sessionId);
  if (!ctx.ok) return ctx;

  // Step 1: EXTRACT (one retry on invalid JSON/shape)
  let extract = await runExtractOnce(apiKey, ctx.payloadBlocks);
  if (!extract.ok) {
    console.error('[recap/extract] first attempt failed:', extract.error);
    extract = await runExtractOnce(apiKey, ctx.payloadBlocks);
  }
  if (!extract.ok) {
    console.error('[recap/extract] retry failed:', extract.error);
    return { ok: false, status: 500, error: 'Recap failed, try again' };
  }

  const scenes = extract.scenes;

  // Step 2: WRITE
  let write = await runWrite(apiKey, scenes, ctx.partyBlock);
  if (!write.ok) {
    return { ok: false, status: 500, error: write.error || 'Recap failed, try again' };
  }

  let raw = write.raw;

  // Step 3: VERIFY (+ at most one revision)
  const verified = await runVerify(apiKey, scenes, raw);
  let revised = false;
  if (verified.problems.length > 0) {
    const revision = await runWrite(apiKey, scenes, ctx.partyBlock, raw, verified.problems);
    if (revision.ok) {
      raw = revision.raw;
      revised = true;
    } else {
      console.error('[recap/write-revise] failed; keeping first draft:', revision.error);
    }
  }

  const { subtitle, body } = parseModelRecapOutput(raw);
  if (!body && !subtitle) {
    return { ok: false, status: 500, error: 'Empty response from AI' };
  }

  const verify_report = {
    problems: verified.problems,
    revised,
    verify_parse_ok: verified.verify_parse_ok,
  };

  if (isRecapDebug()) {
    debugLog('verify-report', 'json', JSON.stringify(verify_report, null, 2));
  }

  return {
    ok: true,
    session: ctx.session,
    sources: ctx.sources,
    raw,
    subtitle,
    body,
    verify_report,
  };
}

module.exports = {
  runChroniclePipeline,
  validateExtractPayload,
  validateVerifyPayload,
  isRecapDebug,
};
