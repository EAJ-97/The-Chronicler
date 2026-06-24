import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chroniclerUrlTransform } from '../utils/chroniclerUrlTransform.js';
import { buildMarkdownComponents } from '../utils/markdownComponents.jsx';
import { getCategoryColor } from '../theme/categoryColors.js';
import { buildMarkdownCss } from '../theme/markdownCss.js';
import { useTheme } from '../theme/useTheme.js';
import { timelineBoxTitle } from '../utils/timelineGeometry.js';

const EXPAND_MS = 300;
const FADE_MS = 160;
const PANEL_MAX_W = 580;

/**
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
function normalizeRect(rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Target panel rect centered in the viewport.
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
function computeTargetRect() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(PANEL_MAX_W, vw - 40);
  const h = Math.min(Math.round(vh * 0.82), vh - 40);
  return {
    left: (vw - w) / 2,
    top: (vh - h) / 2,
    width: w,
    height: h,
  };
}

/**
 * Expands from a timeline box rect into a scrollable linked-note preview (ImageLightbox-style fly).
 * @param {{
 *   entry: object,
 *   note: object,
 *   sourceRect: { left: number, top: number, width: number, height: number },
 *   getSourceRect?: () => { left: number, top: number, width: number, height: number } | null,
 *   loading?: boolean,
 *   loadError?: boolean,
 *   canGoBack?: boolean,
 *   onBack?: () => void,
 *   onClose: () => void,
 *   onOpenReferenceNote?: (noteId: number) => void,
 * }} props
 */
export default function TimelineNoteExpand({
  entry,
  note,
  sourceRect,
  getSourceRect,
  loading = false,
  loadError = false,
  canGoBack = false,
  onBack,
  onClose,
  onOpenReferenceNote,
}) {
  const { theme } = useTheme();
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [flyRect, setFlyRect] = useState(() => normalizeRect(sourceRect));
  const [flyRadius, setFlyRadius] = useState(4);
  const [flyTransition, setFlyTransition] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef(null);
  const expandTimerRef = useRef(null);
  const isClosingRef = useRef(false);

  const categoryColor = getCategoryColor(note?.category || entry?.note_category || 'general');
  const displayTitle = timelineBoxTitle(entry);
  const readingTitle = canGoBack && note?.title ? note.title : displayTitle;
  const mdComponents = buildMarkdownComponents({ onOpenReferenceNote });

  /**
   * Animates the panel from the timeline box to the centered reading view.
   */
  const startEnterAnimation = useCallback(() => {
    const target = computeTargetRect();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyTransition(true);
        setOverlayOpacity(1);
        setFlyRect(target);
        setFlyRadius(8);
      });
    });
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = setTimeout(() => {
      setFlyTransition(false);
      expandTimerRef.current = null;
    }, EXPAND_MS);
  }, []);

  useEffect(() => {
    startEnterAnimation();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    };
  }, [startEnterAnimation]);

  /**
   * Collapses back toward the source box, then calls onClose.
   */
  const requestClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsClosing(true);

    const exitSource = getSourceRect?.() || sourceRect;
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyTransition(true);
        setFlyRect(normalizeRect(exitSource));
        setFlyRadius(4);
        setOverlayOpacity(0);
      });
    });

    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, EXPAND_MS);
  }, [getSourceRect, sourceRect, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const flyStyle = {
    position: 'fixed',
    left: flyRect.left,
    top: flyRect.top,
    width: flyRect.width,
    height: flyRect.height,
    zIndex: 10001,
    borderRadius: flyRadius,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: '#0c0e16',
    border: `1px solid ${categoryColor}55`,
    boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
    transition: flyTransition
      ? `left ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), width ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), height ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), border-radius ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
      : 'none',
    willChange: flyTransition ? 'left, top, width, height' : 'auto',
    pointerEvents: isClosing ? 'none' : 'auto',
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={displayTitle}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(4, 5, 10, 0.88)',
        opacity: overlayOpacity,
        transition: `opacity ${EXPAND_MS}ms ease-out`,
        pointerEvents: isClosing ? 'none' : 'auto',
      }}
      onClick={requestClose}
    >
      <div style={flyStyle} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px',
            borderBottom: `1px solid ${categoryColor}33`,
            background: `linear-gradient(180deg, ${categoryColor}18 0%, transparent 100%)`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (canGoBack) onBack?.();
            }}
            disabled={!canGoBack}
            style={{
              flexShrink: 0,
              background: 'rgba(200,148,58,0.08)',
              border: '1px solid var(--ch-border-strong)',
              borderRadius: '3px',
              cursor: canGoBack ? 'pointer' : 'not-allowed',
              opacity: canGoBack ? 1 : 0.35,
              padding: '6px 10px',
              fontFamily: 'Cinzel, serif',
              fontSize: '9px',
              letterSpacing: '0.12em',
              color: 'var(--ch-accent)',
              marginTop: '2px',
            }}
          >
            ← BACK
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'Cinzel, serif',
                fontSize: '13px',
                letterSpacing: '0.06em',
                color: 'var(--ch-text-primary)',
                lineHeight: 1.3,
              }}
            >
              {readingTitle}
            </div>
            {canGoBack && displayTitle !== readingTitle ? (
              <div
                style={{
                  fontFamily: 'Crimson Pro, serif',
                  fontSize: '11px',
                  color: 'rgba(226,213,187,0.4)',
                  marginTop: '4px',
                  fontStyle: 'italic',
                }}
              >
                {displayTitle}
              </div>
            ) : null}
            {!canGoBack && entry.time_label ? (
              <div
                style={{
                  fontFamily: 'Cinzel, serif',
                  fontSize: '9px',
                  letterSpacing: '0.1em',
                  color: categoryColor,
                  marginTop: '4px',
                }}
              >
                {entry.time_label}
              </div>
            ) : null}
            {!canGoBack && note?.title && note.title !== displayTitle ? (
              <div
                style={{
                  fontFamily: 'Crimson Pro, serif',
                  fontSize: '12px',
                  color: 'rgba(226,213,187,0.45)',
                  marginTop: '4px',
                  fontStyle: 'italic',
                }}
              >
                {note.title}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: '3px',
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--ch-text-primary-55)',
              fontSize: '18px',
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 20px 20px',
            fontFamily: 'Crimson Pro, serif',
            fontSize: '15px',
            lineHeight: 1.75,
            color: 'var(--ch-text-primary)',
          }}
        >
          {loading ? (
            <div
              style={{
                fontFamily: 'Cinzel, serif',
                fontSize: '10px',
                letterSpacing: '0.12em',
                color: 'rgba(200,148,58,0.5)',
              }}
            >
              Loading…
            </div>
          ) : loadError ? (
            <span style={{ color: 'rgba(220,100,100,0.85)' }}>
              Could not load this note.
            </span>
          ) : note?.content != null && note.content !== '' ? (
            <div className="md-timeline-expand">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={chroniclerUrlTransform}
                components={mdComponents}
              >
                {note.content}
              </ReactMarkdown>
            </div>
          ) : (
            <span style={{ color: 'rgba(226,213,187,0.35)', fontStyle: 'italic' }}>
              No content yet.
            </span>
          )}
        </div>
      </div>

      <style>{`
        ${buildMarkdownCss(theme).replace(/\.md-content/g, '.md-timeline-expand').replace(/\.md-preview/g, '.md-timeline-expand').replace(/\.md-ref-peek/g, '.md-timeline-expand')}
        .md-timeline-expand h1 { font-size: 18px; }
        .md-timeline-expand h2 { font-size: 16px; }
        .md-timeline-expand h3 { font-size: 14px; }
        .md-timeline-expand a { cursor: pointer; }
      `}</style>
    </div>,
    document.body,
  );
}
