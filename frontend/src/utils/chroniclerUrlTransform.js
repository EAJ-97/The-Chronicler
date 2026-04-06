import { defaultUrlTransform } from 'react-markdown';

/**
 * react-markdown strips URLs whose protocol is not http(s)/mailto/irc/xmpp, so `note:123`
 * becomes "" and links fall back to unsafe navigation. Allow `note:<id>` through unchanged.
 *
 * @param {string} value — Raw href from markdown
 * @param {string} key — 'href' | 'src' | …
 * @param {import('hast').Element} [node] — Optional element (react-markdown passes this)
 * @returns {string}
 */
export function chroniclerUrlTransform(value, key) {
  let v = String(value ?? '').trim();
  if (key === 'href' && v.includes('%')) {
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep v */
    }
  }
  if (key === 'href' && /^note:\d+$/i.test(v)) return v;
  return defaultUrlTransform(value);
}
