import { useEffect, useState, useCallback } from 'react';

/**
 * Full-screen guided tour with a spotlight cutout (focus region stays bright, rest dimmed).
 * @param {object} props
 * @param {boolean} props.open - When true, overlay is visible
 * @param {function} props.onClose - Called when user dismisses (X or Escape on first step optional)
 * @param {number} props.stepIndex - Current step (0-based)
 * @param {function(number): void} props.setStepIndex - Step setter
 * @param {{ id: string, chapterId?: string, chapter: string, subsection?: string, title: string, body: string, target: string, highlightVariant?: 'normal'|'danger' }[]} props.steps - target keys map to refs
 * @param {Record<string, import('react').RefObject<HTMLElement|null>>} props.targetRefs - Named element refs for spotlight
 * @param {{ id: string, label: string }[]} props.chapters - Unique chapters for the chapter picker
 */

const DIM_RGBA = 'rgba(0,0,0,0.72)';
const HOLE_PAD = 8;
const DANGER_RGBA = 'rgba(224,112,112,0.85)';

export default function TutorialOverlay({ open, onClose, stepIndex, setStepIndex, steps, targetRefs, chapters, cardRef = null }) {
  const [hole, setHole] = useState(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const measure = useCallback(() => {
    if (!open || !steps.length) {
      setHole(null);
      return;
    }
    const step = steps[stepIndex];
    if (!step) {
      setHole(null);
      return;
    }
    const ref = targetRefs[step.target];
    const el = ref?.current;
    if (!el) {
      setHole({ top: '15%', left: '10%', width: '80%', height: '50%', borderRadius: 12 });
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = HOLE_PAD;
    setHole({
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
      borderRadius: 8,
    });
  }, [open, stepIndex, steps, targetRefs]);

  useEffect(() => {
    if (!open) return undefined;
    measure();
    // Re-measure after async layout/view transitions (next frame + shortly after).
    const raf = requestAnimationFrame(() => measure());
    const t = setTimeout(() => measure(), 120);
    const ro = new ResizeObserver(() => measure());
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    Object.values(targetRefs).forEach((ref) => {
      if (ref?.current) ro.observe(ref.current);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure, targetRefs]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // When tutorial is open, capture keyboard so the app cannot be interacted with.
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (stepIndex > 0) setStepIndex(stepIndex - 1);
      }
      // Swallow any other keys so the underlying app doesn't respond.
      if (e.key && e.key.length) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose, stepIndex, setStepIndex, steps.length]);

  if (!open || !steps.length) return null;

  const step = steps[stepIndex];
  const cardStyle = {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 420,
    width: 'min(92vw, 420px)',
    zIndex: 10002,
    background: '#0f1219',
    border: '1px solid rgba(200,148,58,0.35)',
    borderRadius: 8,
    padding: '16px 18px',
    boxShadow: '0 12px 48px rgba(0,0,0,0.75)',
    fontFamily: 'Crimson Pro, serif',
    color: 'rgba(226,213,187,0.92)',
    lineHeight: 1.5,
  };

  const holeStyle = hole
    ? {
        position: 'fixed',
        top: hole.top,
        left: hole.left,
        width: Math.max(40, hole.width),
        height: Math.max(40, hole.height),
        borderRadius: hole.borderRadius ?? 8,
        boxShadow: `0 0 0 9999px ${DIM_RGBA}`,
        // Spotlight is purely visual; the tutorial overlay blocks interaction.
        pointerEvents: 'none',
        zIndex: 10000,
        transition: 'top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease',
      }
    : {
        position: 'fixed',
        inset: 0,
        background: DIM_RGBA,
        zIndex: 10000,
        pointerEvents: 'none',
      };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'auto' }}>
      {/* Full-screen blocker (prevents click-through). */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 9999, pointerEvents: 'auto' }}
        onClick={(e) => e.preventDefault()}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onTouchMove={(e) => { e.preventDefault(); e.stopPropagation(); }}
        aria-hidden
      />

      {/* Spotlight hole (visual only). */}
      <div
        style={{
          ...holeStyle,
          ...(step?.highlightVariant === 'danger'
            ? { outline: `2px solid ${DANGER_RGBA}`, outlineOffset: 0 }
            : null),
        }}
        aria-hidden
      />

      <div ref={cardRef} style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: 'Cinzel', fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(200,148,58,0.55)', marginBottom: 4 }}>
              {step.chapter}
            </div>
            {!!step.subsection && (
              <div style={{ fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(226,213,187,0.45)', marginBottom: 4 }}>
                {step.subsection}
              </div>
            )}
            <div style={{ fontFamily: 'Cinzel', fontSize: '12px', letterSpacing: '0.08em', color: '#c8943a' }}>{step.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'rgba(226,213,187,0.5)', cursor: 'pointer',
              fontSize: '22px', lineHeight: 1, padding: 0, pointerEvents: 'auto',
            }}
            aria-label="Close tutorial"
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: '14px', marginBottom: 14 }}>{step.body}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
          <button type="button" style={btn()} onClick={() => setStepIndex(Math.max(0, stepIndex - 1))} disabled={stepIndex <= 0}>
            ← Back
          </button>
          <button
            type="button"
            style={btn(true)}
            onClick={() => (stepIndex < steps.length - 1 ? setStepIndex(stepIndex + 1) : onClose())}
          >
            {stepIndex < steps.length - 1 ? 'Next →' : 'Done'}
          </button>
          <button type="button" style={btn()} onClick={() => setChaptersOpen((v) => !v)}>
            Chapters
          </button>
          <span style={{ fontFamily: 'Cinzel', fontSize: '9px', color: 'rgba(226,213,187,0.35)', marginLeft: 'auto' }}>
            {stepIndex + 1} / {steps.length}
          </span>
        </div>
        {chaptersOpen && chapters?.length > 0 && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid rgba(200,148,58,0.15)',
              maxHeight: 160,
              overflowY: 'auto',
              pointerEvents: 'auto',
            }}
          >
            {chapters.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  const idx = steps.findIndex((s) => s.chapterId === ch.id);
                  if (idx >= 0) setStepIndex(idx);
                  setChaptersOpen(false);
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 6px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(200,148,58,0.85)',
                }}
              >
                {ch.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function btn(primary) {
  return {
    fontFamily: 'Cinzel',
    fontSize: '9px',
    letterSpacing: '0.12em',
    padding: '8px 14px',
    borderRadius: 4,
    border: `1px solid ${primary ? 'rgba(200,148,58,0.5)' : 'rgba(226,213,187,0.2)'}`,
    background: primary ? 'rgba(200,148,58,0.15)' : 'transparent',
    color: primary ? '#c8943a' : 'rgba(226,213,187,0.65)',
    cursor: 'pointer',
    pointerEvents: 'auto',
  };
}
