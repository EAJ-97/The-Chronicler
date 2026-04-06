/**
 * Calls Google Gemini image generation (Nano Banana family) for small TTRPG sidebar icons.
 * Uses REST generateContent with responseModalities IMAGE only — no search tools.
 */

/** Fixed instructions so the model treats every request as a tiny list icon, not a full scene. */
const ICON_SYSTEM_INSTRUCTION = `You are generating a single small UI icon for a fantasy tabletop RPG chronicle sidebar (a tree list next to notes and folders).

Strict requirements:
- Output exactly one square image that stays readable when scaled down to about 24–32 pixels on screen.
- Simple, centered subject with a clear silhouette; avoid tiny details that disappear when small.
- Use a plain, soft, or subtly graded background — not a busy environment.
- Do not include text, letters, numbers, watermarks, or logos in the image (model watermarks are acceptable).
- PG-13 only: no gore, horror, sexual content, or hateful imagery.

The user will describe the subject or mood to depict.`;

/**
 * Invokes Gemini image-capable model and returns the first inline image part.
 * @param {string} apiKey — Google AI Studio / Gemini API key
 * @param {string} userPrompt — short theme (e.g. "bronze compass rose"); may be empty for a generic icon
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function generateChronicleListIcon(apiKey, userPrompt) {
  const model = (process.env.GEMINI_ICON_MODEL || 'gemini-2.5-flash-image').trim();
  const subject = (userPrompt || '').trim() || 'A neutral fantasy chronicle motif such as a scroll, seal, or subtle magical spark.';
  const text = `${ICON_SYSTEM_INSTRUCTION}\n\nSubject / mood: ${subject}`.slice(0, 16000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const mime = String(inline.mimeType || inline.mime_type || 'image/png').toLowerCase();
      return { buffer: Buffer.from(inline.data, 'base64'), mimeType: mime };
    }
  }

  const block = data?.promptFeedback?.blockReason;
  if (block) throw new Error(`Blocked: ${block}`);
  throw new Error('No image in model response');
}

module.exports = { generateChronicleListIcon };
