import { useState, useCallback, useRef } from 'react';
import { isManagedSidebarIconUrl } from '../utils/displayIcons.js';
import ImageLightbox from './ImageLightbox.jsx';

/** Inline preview size for uploaded note images in markdown (not sidebar icons). */
const INLINE_IMG_STYLE = {
  display: 'block',
  margin: '12px 0',
  maxWidth: 'min(100%, 520px)',
  maxHeight: '400px',
  width: 'auto',
  height: 'auto',
  objectFit: 'contain',
  borderRadius: '4px',
  border: '1px solid rgba(255, 255, 255, 0.1)',
};

const ZOOMABLE_IMG_STYLE = {
  ...INLINE_IMG_STYLE,
  cursor: 'zoom-in',
};

/**
 * Renders markdown images: uploaded note images show a readable inline preview and
 * open a full-screen lightbox on click. Other image URLs render without zoom.
 * @param {import('react').ImgHTMLAttributes<HTMLImageElement>} props
 */
export default function MarkdownImage({ src, alt, title, ...rest }) {
  const inlineRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sourceRect, setSourceRect] = useState(null);
  const zoomable = isManagedSidebarIconUrl(src);

  /**
   * Opens the lightbox and captures the inline image rect for the expand animation.
   * @param {HTMLElement} el
   */
  const openFromElement = useCallback((el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSourceRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    setLightboxOpen(true);
  }, []);

  const close = useCallback(() => setLightboxOpen(false), []);

  /**
   * Returns the current inline image rect for the collapse animation.
   * @returns {{ left: number, top: number, width: number, height: number } | null}
   */
  const getSourceRect = useCallback(() => {
    const el = inlineRef.current;
    if (!el) return sourceRect;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [sourceRect]);

  if (!zoomable) {
    return (
      <img
        {...rest}
        src={src}
        alt={alt}
        title={title}
        style={{ ...INLINE_IMG_STYLE, ...(rest.style || {}) }}
      />
    );
  }

  return (
    <>
      <img
        ref={inlineRef}
        {...rest}
        src={src}
        alt={alt}
        title={title || 'Click to expand'}
        style={{
          ...ZOOMABLE_IMG_STYLE,
          ...(rest.style || {}),
          visibility: lightboxOpen ? 'hidden' : 'visible',
        }}
        role="button"
        tabIndex={0}
        onClick={(e) => openFromElement(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFromElement(inlineRef.current);
          }
        }}
      />
      {lightboxOpen && src && (
        <ImageLightbox
          src={src}
          alt={alt}
          sourceRect={sourceRect}
          getSourceRect={getSourceRect}
          onClose={close}
        />
      )}
    </>
  );
}
