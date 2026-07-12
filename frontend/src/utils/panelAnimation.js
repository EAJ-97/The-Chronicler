/** Slide duration for reference peek panel — matches image lightbox expand/collapse. */
export const PEEK_PANEL_MS = 300;

/** Easing for peek panel slide — matches ImageLightbox hero expand. */
export const PEEK_PANEL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** CSS transition for split-layout width changes (editor + peek column). */
export const PEEK_SPLIT_TRANSITION = `width ${PEEK_PANEL_MS}ms ${PEEK_PANEL_EASING}, flex-basis ${PEEK_PANEL_MS}ms ${PEEK_PANEL_EASING}, max-width ${PEEK_PANEL_MS}ms ${PEEK_PANEL_EASING}`;
