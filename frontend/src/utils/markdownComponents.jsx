import MarkdownImage from '../components/MarkdownImage.jsx';
import { buildMarkdownCss } from '../theme/markdownCss.js';
import { CHRONICLER_DEFAULT } from '../theme/chroniclerDefault.js';

/**
 * Builds shared react-markdown component overrides (note links + zoomable images).
 * @param {{ onOpenReferenceNote?: (noteId: number) => void }} [options]
 * @returns {import('react-markdown').Components}
 */
export function buildMarkdownComponents({ onOpenReferenceNote } = {}) {
  return {
    a: ({ href, children }) => {
      const h = href != null ? String(href).trim() : '';
      if (h && /^note:\d+$/i.test(h)) {
        const nid = parseInt(h.replace(/^note:/i, ''), 10);
        return (
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              cursor: onOpenReferenceNote ? 'pointer' : 'default',
              color: 'var(--ch-accent)',
              textDecoration: 'underline',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              padding: 0,
            }}
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (onOpenReferenceNote) onOpenReferenceNote(nid);
            }}
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ch-accent)' }}>
          {children}
        </a>
      );
    },
    img: ({ node, ...props }) => <MarkdownImage {...props} />,
  };
}

/** Static fallback for components not yet wired to useTheme (matches default Chronicler theme). */
export const MARKDOWN_BASE_CSS = buildMarkdownCss(CHRONICLER_DEFAULT);

export { buildMarkdownCss };
