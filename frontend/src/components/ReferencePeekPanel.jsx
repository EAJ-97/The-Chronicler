import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';
import { getCategoryColor } from './NoteEditor.jsx';

/**
 * Renders a read-only markdown preview of stacked referenced notes (opened from `note:` links).
 * The top of `stack` is the visible page; the previous id is shown dimmed behind for a “turning pages” cue.
 * Nested `note:` links call `onOpenReference` to push another id onto the stack.
 *
 * @param {object} props
 * @param {number[]} props.stack — Ordered note ids from outermost (first opened) to current top.
 * @param {object[]} props.notes — Full note rows (merged from Dashboard); used to resolve titles and content.
 * @param {() => void} props.onBack — Pop one level (disabled when stack length ≤ 1 is handled by hiding or disabling).
 * @param {() => void} props.onClose — Clear the stack and return focus to the main editor note.
 * @param {(noteId: number) => void} props.onOpenReference — Push another referenced note onto the stack.
 * @param {boolean} props.isMobile — When true, panel is a full-screen overlay instead of the right column.
 */
export default function ReferencePeekPanel({
  stack,
  notes,
  onBack,
  onClose,
  onOpenReference,
  isMobile,
}) {
  const topId = stack.length ? stack[stack.length - 1] : null;
  const prevId = stack.length >= 2 ? stack[stack.length - 2] : null;
  const note = topId != null ? notes.find((n) => n.id === topId) : null;
  const prevNote = prevId != null ? notes.find((n) => n.id === prevId) : null;
  const color = getCategoryColor(note?.category);

  /**
   * Markdown `a` handler: `note:123` opens the reference stack; other links open in a new tab.
   */
  const mdComponents = {
    a: ({ href, children }) => {
      const h = href != null ? String(href).trim() : '';
      if (/^note:\d+$/i.test(h)) {
        const nid = parseInt(h.replace(/^note:/i, ''), 10);
        return (
          <button
            type="button"
            className="ref-peek-md-link"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#c8943a',
              textDecoration: 'underline',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              padding: 0,
            }}
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (typeof onOpenReference === 'function') onOpenReference(nid);
            }}
          >
            {children}
          </button>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#c8943a' }}
        >
          {children}
        </a>
      );
    },
  };

  const shellStyle = isMobile
    ? {
        position: 'fixed',
        top: 'calc(52px + env(safe-area-inset-top))',
        left: 0,
        right: 0,
        bottom: 'calc(44px + env(safe-area-inset-bottom))',
        zIndex: 350,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0c14',
        borderTop: '1px solid rgba(200,148,58,0.2)',
        overflow: 'hidden',
      }
    : {
        flex: '1 1 50%',
        minWidth: 0,
        maxWidth: '50%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0c14',
        borderLeft: '1px solid rgba(200,148,58,0.15)',
        overflow: 'hidden',
      };

  return (
    <div style={shellStyle}>
      <div style={{ height: '2px', background: `linear-gradient(90deg, ${color}, transparent)`, flexShrink: 0 }} />

      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={stack.length <= 1}
          style={{
            background: 'rgba(200,148,58,0.08)',
            border: '1px solid rgba(200,148,58,0.2)',
            borderRadius: '3px',
            cursor: stack.length <= 1 ? 'not-allowed' : 'pointer',
            opacity: stack.length <= 1 ? 0.35 : 1,
            padding: '4px 10px',
            fontFamily: 'Cinzel',
            fontSize: '9px',
            letterSpacing: '0.12em',
            color: '#c8943a',
          }}
        >
          ← BACK
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid rgba(226,213,187,0.15)',
            borderRadius: '3px',
            cursor: 'pointer',
            padding: '4px 10px',
            fontFamily: 'Cinzel',
            fontSize: '9px',
            letterSpacing: '0.12em',
            color: 'rgba(226,213,187,0.65)',
          }}
        >
          CLOSE
        </button>
        <span
          style={{
            fontFamily: 'Cinzel',
            fontSize: '8px',
            letterSpacing: '0.12em',
            color: 'rgba(200,148,58,0.35)',
            marginLeft: 'auto',
          }}
        >
          REF {stack.length > 1 ? `(${stack.length})` : ''}
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {prevNote && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: '12px 16px',
              transform: 'translateX(-8%) scale(0.97)',
              opacity: 0.28,
              pointerEvents: 'none',
              overflow: 'hidden',
              filter: 'blur(0.3px)',
            }}
          >
            <div
              style={{
                fontFamily: 'Cinzel',
                fontSize: '11px',
                color: 'rgba(200,148,58,0.5)',
                marginBottom: '6px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {prevNote.title || '—'}
            </div>
            <div
              style={{
                fontFamily: 'Crimson Pro, serif',
                fontSize: '12px',
                lineHeight: 1.5,
                color: 'rgba(226,213,187,0.35)',
                maxHeight: '45%',
                overflow: 'hidden',
              }}
            >
              {(prevNote.content || '').slice(0, 500)}
            </div>
          </div>
        )}

        <div
          key={topId}
          className="ref-peek-top-page"
          style={{
            position: 'relative',
            zIndex: 2,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(180deg, rgba(10,12,20,0.98) 0%, #0a0c14 48px)',
            boxShadow: prevNote ? '-12px 0 24px rgba(0,0,0,0.35)' : 'none',
          }}
        >
          <div
            style={{
              padding: '12px 16px 8px',
              flexShrink: 0,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div
              style={{
                fontFamily: 'Cinzel',
                fontSize: '14px',
                fontWeight: 500,
                color: '#e2d5bb',
                letterSpacing: '0.03em',
                marginBottom: '6px',
                lineHeight: 1.3,
              }}
            >
              {note?.title || (note ? 'Untitled' : 'Loading…')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: 'Cinzel',
                  fontSize: '8px',
                  letterSpacing: '0.15em',
                  color: `${color}aa`,
                  textTransform: 'uppercase',
                }}
              >
                {note?.category || '—'}
              </span>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px 20px',
              fontFamily: 'Crimson Pro, serif',
              fontSize: '15px',
              lineHeight: 1.75,
              color: '#e2d5bb',
            }}
          >
            {note?.content != null && note.content !== '' ? (
              <div className="md-ref-peek">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={chroniclerUrlTransform}
                  components={mdComponents}
                >
                  {note.content}
                </ReactMarkdown>
              </div>
            ) : (
              <span style={{ color: 'rgba(226,213,187,0.25)', fontStyle: 'italic' }}>
                {note ? 'No content yet.' : 'Loading…'}
              </span>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes refPeekPageIn {
          from {
            transform: translateX(28px);
            opacity: 0.65;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .ref-peek-top-page {
          animation: refPeekPageIn 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .md-ref-peek h1, .md-ref-peek h2, .md-ref-peek h3 {
          font-family: 'Cinzel', serif;
          color: #c8943a;
          margin: 14px 0 6px;
          letter-spacing: 0.04em;
        }
        .md-ref-peek h1 { font-size: 17px; }
        .md-ref-peek h2 { font-size: 15px; }
        .md-ref-peek h3 { font-size: 14px; }
        .md-ref-peek p { margin: 0 0 8px; }
        .md-ref-peek ul, .md-ref-peek ol { padding-left: 18px; margin: 0 0 8px; }
        .md-ref-peek li { margin-bottom: 3px; }
        .md-ref-peek blockquote {
          border-left: 2px solid rgba(200,148,58,0.3);
          margin: 0 0 8px;
          padding: 4px 10px;
          color: rgba(226,213,187,0.55);
          font-style: italic;
        }
        .md-ref-peek code {
          background: rgba(255,255,255,0.06);
          border-radius: 2px;
          padding: 1px 5px;
          font-size: 13px;
          font-family: monospace;
        }
        .md-ref-peek strong { color: #e2d5bb; font-weight: 600; }
        .md-ref-peek em { color: rgba(226,213,187,0.75); }
        .md-ref-peek hr { border: none; border-top: 1px solid rgba(200,148,58,0.15); margin: 12px 0; }
        .md-ref-peek img { max-width: 100%; height: auto; border-radius: 4px; display: block; margin: 8px 0; }
      `}</style>
    </div>
  );
}
