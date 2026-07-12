import { useState, useEffect, useMemo } from 'react';
import { getCategoryColor } from '../theme/categoryColors.js';
import api from '../api.js';
import { PEEK_SPLIT_TRANSITION } from '../utils/panelAnimation.js';

/**
 * Short preview line for a note card (display_summary or trimmed body).
 * @param {object} note
 * @returns {string}
 */
function noteCardSnippet(note) {
  if (note?.display_summary?.trim()) return note.display_summary.trim();
  const plain = String(note?.content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_\[\]()>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return 'Empty note.';
  return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
}

/**
 * Grid of preview cards for notes under an organizer subfolder (recursive descendants).
 *
 * @param {object} props
 * @param {Array<object>} childNotes - Note rows from the list API
 * @param {Array<object>} [allNotes] - Full list for parent-folder labels
 * @param {number|null} [folderId] - Folder being viewed (hide path when note is direct child)
 * @param {(noteId: number) => void} onOpenNote
 * @param {object} [containerStyle]
 */
export default function FolderNoteCards({
  childNotes,
  allNotes = [],
  folderId = null,
  onOpenNote,
  containerStyle,
}) {
  const [loaded, setLoaded] = useState([]);
  const [loading, setLoading] = useState(false);

  const parentTitleById = useMemo(() => {
    const m = new Map();
    (allNotes || []).forEach((n) => {
      if (n.is_folder) m.set(n.id, n.title || 'Untitled folder');
    });
    return m;
  }, [allNotes]);

  const idsKey = (childNotes || []).map((n) => n.id).join(',');

  useEffect(() => {
    const rows = childNotes || [];
    if (rows.length === 0) {
      setLoaded([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      rows.map((n) =>
        api.get(`/notes/${n.id}`).then((r) => r.data).catch(() => ({ ...n, content: '' })),
      ),
    )
      .then((full) => {
        if (!cancelled) setLoaded(full);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!childNotes?.length) {
    return (
      <div
        style={{
          ...containerStyle,
          color: 'rgba(226,213,187,0.35)',
          fontStyle: 'italic',
          fontFamily: 'Crimson Pro, serif',
          fontSize: '14px',
          padding: '12px 24px',
        }}
      >
        No notes in this folder yet.
      </div>
    );
  }

  return (
    <div
      style={{
        ...containerStyle,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ch-font-display)',
          fontSize: '8px',
          letterSpacing: '0.14em',
          color: 'rgba(139,196,226,0.55)',
          padding: '10px 24px 8px',
          flexShrink: 0,
        }}
      >
        Notes in this folder
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 20px 16px',
          transition: PEEK_SPLIT_TRANSITION,
        }}
      >
        {loading && loaded.length === 0 ? (
          <div style={{ fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.35)', padding: '4px' }}>
            Loading…
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignContent: 'flex-start',
          }}
        >
          {(loaded.length ? loaded : childNotes).map((n) => {
            const catColor = getCategoryColor(n.category);
            const parentId = Number(n.parent_id);
            const showPath = folderId != null && parentId !== Number(folderId);
            const parentLabel = showPath ? parentTitleById.get(parentId) : null;
            const snippet = loaded.length ? noteCardSnippet(n) : (n.display_summary?.trim() || '…');

            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onOpenNote?.(n.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  textAlign: 'left',
                  flex: '1 1 220px',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 14px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderLeft: `3px solid ${catColor}`,
                  background: 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  minHeight: '100px',
                  transition: `${PEEK_SPLIT_TRANSITION}, background 0.15s, border-color 0.15s`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139,196,226,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(139,196,226,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              >
                <span
                  style={{
                    fontFamily: 'Cinzel, serif',
                    fontSize: '12px',
                    letterSpacing: '0.05em',
                    color: catColor,
                    marginBottom: parentLabel ? '4px' : '6px',
                    lineHeight: 1.3,
                  }}
                >
                  {n.title || 'Untitled'}
                </span>
                {parentLabel ? (
                  <span
                    style={{
                      fontFamily: 'var(--ch-font-display)',
                      fontSize: '7px',
                      letterSpacing: '0.08em',
                      color: 'rgba(226,213,187,0.35)',
                      marginBottom: '6px',
                    }}
                  >
                    in {parentLabel}
                  </span>
                ) : null}
                <span
                  style={{
                    fontFamily: 'Crimson Pro, serif',
                    fontSize: '13px',
                    lineHeight: 1.45,
                    color: 'rgba(226,213,187,0.72)',
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {snippet}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
