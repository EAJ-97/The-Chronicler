import MarkdownImage from '../components/MarkdownImage.jsx';

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
              color: '#c8943a',
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
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#c8943a' }}>
          {children}
        </a>
      );
    },
    img: ({ node, ...props }) => <MarkdownImage {...props} />,
  };
}

/** Base typography styles shared by markdown preview regions. */
export const MARKDOWN_BASE_CSS = `
  .md-content h1, .md-content h2, .md-content h3,
  .md-preview h1, .md-preview h2, .md-preview h3,
  .md-ref-peek h1, .md-ref-peek h2, .md-ref-peek h3 {
    font-family: 'Cinzel', serif;
    color: #c8943a;
    margin: 16px 0 6px;
    letter-spacing: 0.04em;
  }
  .md-preview h1, .md-ref-peek h1 { font-size: 16px; }
  .md-preview h2, .md-ref-peek h2 { font-size: 14px; }
  .md-preview h3, .md-ref-peek h3 { font-size: 13px; }
  .md-content p, .md-preview p, .md-ref-peek p { margin: 0 0 10px; }
  .md-preview p, .md-ref-peek p { margin: 0 0 8px; }
  .md-content ul, .md-content ol,
  .md-preview ul, .md-preview ol,
  .md-ref-peek ul, .md-ref-peek ol { padding-left: 20px; margin: 0 0 10px; }
  .md-preview ul, .md-preview ol,
  .md-ref-peek ul, .md-ref-peek ol { padding-left: 18px; margin: 0 0 8px; }
  .md-content blockquote, .md-preview blockquote, .md-ref-peek blockquote {
    border-left: 2px solid rgba(200,148,58,0.3);
    margin: 0 0 10px;
    padding: 4px 12px;
    color: rgba(226,213,187,0.6);
    font-style: italic;
  }
  .md-preview blockquote, .md-ref-peek blockquote { padding: 4px 10px; color: rgba(226,213,187,0.5); }
  .md-content code, .md-preview code, .md-ref-peek code {
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    padding: 1px 5px;
    font-size: 14px;
    font-family: monospace;
  }
  .md-preview code, .md-ref-peek code { font-size: 13px; }
  .md-content strong, .md-preview strong, .md-ref-peek strong { color: #e2d5bb; font-weight: 600; }
  .md-content em, .md-preview em, .md-ref-peek em { color: rgba(226,213,187,0.75); }
  .md-content hr, .md-preview hr, .md-ref-peek hr {
    border: none;
    border-top: 1px solid rgba(200,148,58,0.15);
    margin: 14px 0;
  }
  .md-preview hr, .md-ref-peek hr { margin: 12px 0; }
  .md-content a, .md-preview a, .md-ref-peek a { color: #c8943a; }
`;
