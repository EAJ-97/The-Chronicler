import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWindowWidth } from '../hooks/useWindowWidth.js';

/** Desktop click-zoom multiplier from the fit view. */
const DESKTOP_REGIONAL_ZOOM = 2.5;

/** Viewports at or below this width use pinch-zoom instead of click-zoom. */
const MOBILE_BREAKPOINT = 768;

const FADE_MS = 160;
/** Expand/collapse from inline thumbnail to fullscreen fit (desktop only). */
const EXPAND_MS = 300;
const MOBILE_DOUBLE_TAP_MS = 300;
/** How long the mobile close button stays visible after a tap. */
const MOBILE_CHROME_HIDE_MS = 3000;
const ZOOM_ANIM_MS = 220;

/**
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} rect
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
 * Returns rendered width/height that fits an image inside a viewport box.
 * @param {number} naturalW
 * @param {number} naturalH
 * @param {number} viewportW
 * @param {number} viewportH
 * @returns {{ w: number, h: number } | null}
 */
function computeFitDimensions(naturalW, naturalH, viewportW, viewportH) {
  if (!naturalW || !naturalH || !viewportW || !viewportH) return null;
  const ratio = Math.min(viewportW / naturalW, viewportH / naturalH);
  return { w: naturalW * ratio, h: naturalH * ratio };
}

/**
 * Mobile initial scale: full resolution fit to the limiting viewport axis (contain).
 * @param {number} naturalW
 * @param {number} naturalH
 * @param {number} viewportW
 * @param {number} viewportH
 * @returns {number}
 */
function computeMobileFitScale(naturalW, naturalH, viewportW, viewportH) {
  if (!naturalW || !naturalH || !viewportW || !viewportH) return 1;
  return Math.min(viewportW / naturalW, viewportH / naturalH);
}

/**
 * Max pinch multiplier relative to fit — image at native pixel dimensions (1:1).
 * @param {number} fitScale
 * @returns {number}
 */
function computeMobileFullResZoom(fitScale) {
  if (!fitScale || fitScale <= 0) return 1;
  return 1 / fitScale;
}

/**
 * Pan offset for an incremental zoom step about a viewport point (center-based scale).
 * @param {number} clientX
 * @param {number} clientY
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {{ x: number, y: number }} currentPan
 * @param {number} zoomRatio — multiplier applied this frame (newZoom / oldZoom)
 * @returns {{ x: number, y: number }}
 */
function panForZoomRatio(clientX, clientY, viewportW, viewportH, currentPan, zoomRatio) {
  const centerX = viewportW / 2 + currentPan.x;
  const centerY = viewportH / 2 + currentPan.y;
  const vx = clientX - centerX;
  const vy = clientY - centerY;
  return {
    x: currentPan.x - vx * (zoomRatio - 1),
    y: currentPan.y - vy * (zoomRatio - 1),
  };
}

/**
 * Clamps pan so scaled image edges never leave the viewport.
 * @param {{ x: number, y: number }} pan
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} imgW
 * @param {number} imgH
 * @param {number} scale
 * @returns {{ x: number, y: number }}
 */
function clampPan(pan, viewportW, viewportH, imgW, imgH, scale) {
  const scaledW = imgW * scale;
  const scaledH = imgH * scale;
  const maxX = Math.max(0, (scaledW - viewportW) / 2);
  const maxY = Math.max(0, (scaledH - viewportH) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

/**
 * Pan offset needed to zoom toward a viewport point using center-based scale.
 * @param {number} clientX
 * @param {number} clientY
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {{ x: number, y: number }} currentPan
 * @param {number} targetScale
 * @returns {{ x: number, y: number }}
 */
function panForZoomAtPoint(clientX, clientY, viewportW, viewportH, currentPan, targetScale) {
  const centerX = viewportW / 2 + currentPan.x;
  const centerY = viewportH / 2 + currentPan.y;
  const vx = clientX - centerX;
  const vy = clientY - centerY;
  return {
    x: currentPan.x - vx * (targetScale - 1),
    y: currentPan.y - vy * (targetScale - 1),
  };
}

/**
 * Full-screen image viewer.
 * Desktop: fit to viewport, click to regionally zoom, edge-clamped drag pan, click to unzoom.
 * Mobile: pan + native-pixel sizing (width/height grow with zoom), pinch to full resolution. Fade only.
 * @param {{ src: string, alt?: string, onClose: () => void, sourceRect?: { left: number, top: number, width: number, height: number } | null, getSourceRect?: () => { left: number, top: number, width: number, height: number } | null }} props
 */
export default function ImageLightbox({ src, alt, onClose, sourceRect = null, getSourceRect = null }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= MOBILE_BREAKPOINT;

  const viewportRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef({
    pending: false,
    active: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });
  const movedRef = useRef(false);
  const unzoomTimerRef = useRef(null);
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isUnzoomingRef = useRef(false);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef(null);
  const expandTimerRef = useRef(null);
  const layoutModeRef = useRef('interactive');
  const mobileStageRef = useRef(null);
  const mobileLastTapRef = useRef(0);
  const mobileZoomRef = useRef(1);
  const mobilePanRef = useRef({ x: 0, y: 0 });
  const mobileChromeTimerRef = useRef(null);
  const mobilePinchActiveRef = useRef(false);
  const naturalSizeRef = useRef(null);
  const mobileViewportRef = useRef({ w: 0, h: 0 });
  const mobileFitScaleRef = useRef(1);

  const hasHero = Boolean(sourceRect) && !isMobile;
  const [layoutMode, setLayoutMode] = useState(hasHero ? 'fly' : 'interactive');
  const [flyRect, setFlyRect] = useState(() => (sourceRect && !isMobile ? normalizeRect(sourceRect) : null));
  const [flyTransition, setFlyTransition] = useState(false);
  const [flyRadius, setFlyRadius] = useState(hasHero ? 4 : 0);
  const [suppressTransformTransition, setSuppressTransformTransition] = useState(false);
  const [mobileZoom, setMobileZoom] = useState(1);
  const [mobilePan, setMobilePan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState(null);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));

  const [fitSize, setFitSize] = useState(null);
  const [viewMode, setViewMode] = useState('fit');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isUnzooming, setIsUnzooming] = useState(false);
  /** Frozen fit dimensions while desktop zoom / unzoom animation runs. */
  const [lockedFitSize, setLockedFitSize] = useState(null);

  const isDesktopZoomed = !isMobile && viewMode === 'zoomed';
  const isInteractive = layoutMode === 'interactive';
  const displaySize = lockedFitSize || fitSize;
  const allowTransition = isInteractive && !suppressTransformTransition && !isDragging && !isPinching;
  const overlayFadeMs = hasHero ? EXPAND_MS : FADE_MS;

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    isUnzoomingRef.current = isUnzooming;
  }, [isUnzooming]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    mobileZoomRef.current = mobileZoom;
  }, [mobileZoom]);

  useEffect(() => {
    mobilePanRef.current = mobilePan;
  }, [mobilePan]);

  /**
   * Tracks visual viewport size for mobile fit/zoom math and conditional scroll.
   */
  useEffect(() => {
    if (!isMobile) return;
    const update = () => {
      const vv = window.visualViewport;
      setMobileViewport({
        w: vv?.width ?? window.innerWidth,
        h: vv?.height ?? window.innerHeight,
      });
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [isMobile]);

  const mobileFitScale = naturalSize
    ? computeMobileFitScale(naturalSize.w, naturalSize.h, mobileViewport.w, mobileViewport.h)
    : null;

  useEffect(() => {
    naturalSizeRef.current = naturalSize;
  }, [naturalSize]);

  useEffect(() => {
    mobileViewportRef.current = mobileViewport;
  }, [mobileViewport]);

  useEffect(() => {
    mobileFitScaleRef.current = mobileFitScale ?? 1;
  }, [mobileFitScale]);

  /**
   * Shows the fixed close control, then fades it out after inactivity.
   */
  const showMobileChrome = useCallback(() => {
    setMobileChromeVisible(true);
    if (mobileChromeTimerRef.current) clearTimeout(mobileChromeTimerRef.current);
    mobileChromeTimerRef.current = setTimeout(() => {
      setMobileChromeVisible(false);
    }, MOBILE_CHROME_HIDE_MS);
  }, []);

  /**
   * Double-tap resets zoom to fit; single tap reveals the close button.
   */
  const handleMobileDoubleTap = useCallback(() => {
    setMobileZoom(1);
    setMobilePan({ x: 0, y: 0 });
  }, []);

  /**
   * Detects double-tap on mobile (touch devices do not fire dblclick reliably).
   * @param {React.TouchEvent<HTMLElement>} e
   */
  const handleMobileTap = (e) => {
    e.stopPropagation();
    if (mobilePinchActiveRef.current) return;
    const now = Date.now();
    if (now - mobileLastTapRef.current < MOBILE_DOUBLE_TAP_MS) {
      mobileLastTapRef.current = 0;
      handleMobileDoubleTap();
      return;
    }
    mobileLastTapRef.current = now;
    showMobileChrome();
  };

  /**
   * Pinch-zoom and drag-pan: zoom is applied via rendered width/height (full res at max), not CSS scale.
   */
  useEffect(() => {
    if (!isMobile) return;
    const el = mobileStageRef.current;
    if (!el) return;

    const pinch = { active: false, lastDist: 0 };
    const drag = { active: false, startX: 0, startY: 0, panX: 0, panY: 0 };

    /**
     * @param {TouchList} touches
     * @returns {number}
     */
    const touchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    /**
     * @param {TouchList} touches
     * @param {DOMRect} rect
     * @returns {{ x: number, y: number }}
     */
    const touchFocal = (touches, rect) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
    });

    /** @param {TouchEvent} e */
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        drag.active = false;
        mobilePinchActiveRef.current = true;
        pinch.active = true;
        pinch.lastDist = touchDistance(e.touches);
      } else if (e.touches.length === 1 && mobileZoomRef.current > 1.001) {
        pinch.active = false;
        drag.active = true;
        drag.startX = e.touches[0].clientX;
        drag.startY = e.touches[0].clientY;
        drag.panX = mobilePanRef.current.x;
        drag.panY = mobilePanRef.current.y;
      }
    };

    /** @param {TouchEvent} e */
    const onTouchMove = (e) => {
      const ns = naturalSizeRef.current;
      const fitScale = mobileFitScaleRef.current;
      const viewport = mobileViewportRef.current;
      if (!ns || !fitScale) return;

      const fitW = ns.w * fitScale;
      const fitH = ns.h * fitScale;

      if (pinch.active && e.touches.length === 2 && pinch.lastDist) {
        e.preventDefault();
        mobilePinchActiveRef.current = true;

        const rect = el.getBoundingClientRect();
        const focal = touchFocal(e.touches, rect);
        const dist = touchDistance(e.touches);
        const oldZoom = mobileZoomRef.current;
        const frameRatio = dist / pinch.lastDist;
        pinch.lastDist = dist;
        const maxZoom = computeMobileFullResZoom(fitScale);
        const nextZoom = Math.min(maxZoom, Math.max(1, oldZoom * frameRatio));
        if (Math.abs(nextZoom - oldZoom) < 0.0005) return;

        const zoomRatio = nextZoom / oldZoom;
        const nextPan = panForZoomRatio(
          focal.x,
          focal.y,
          viewport.w,
          viewport.h,
          mobilePanRef.current,
          zoomRatio,
        );
        const clampedPan = clampPan(nextPan, viewport.w, viewport.h, fitW, fitH, nextZoom);
        mobileZoomRef.current = nextZoom;
        mobilePanRef.current = clampedPan;
        setMobileZoom(nextZoom);
        setMobilePan(clampedPan);
        return;
      }

      if (drag.active && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - drag.startX;
        const dy = e.touches[0].clientY - drag.startY;
        const nextPan = clampPan(
          { x: drag.panX + dx, y: drag.panY + dy },
          viewport.w,
          viewport.h,
          fitW,
          fitH,
          mobileZoomRef.current,
        );
        mobilePanRef.current = nextPan;
        setMobilePan(nextPan);
      }
    };

    /** @param {TouchEvent} e */
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinch.active = false;
      if (e.touches.length === 0) drag.active = false;
      if (mobilePinchActiveRef.current) {
        setTimeout(() => {
          mobilePinchActiveRef.current = false;
        }, 80);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile, naturalSize]);

  useEffect(() => {
    return () => {
      if (mobileChromeTimerRef.current) clearTimeout(mobileChromeTimerRef.current);
    };
  }, []);

  /**
   * Stores natural pixel size for full-resolution scroll/zoom on mobile.
   */
  const handleMobileImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setMobileZoom(1);
    setMobilePan({ x: 0, y: 0 });
  }, []);

  /**
   * Fades the overlay in on mount when there is no hero expand animation.
   */
  useEffect(() => {
    if (hasHero) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setOverlayOpacity(1));
    });
    return () => cancelAnimationFrame(raf);
  }, [hasHero]);

  /**
   * Animates the image from the inline thumbnail rect to the centered fit view.
   */
  const startEnterAnimation = useCallback(() => {
    if (!sourceRect || layoutModeRef.current !== 'fly') return;
    const viewport = viewportRef.current;
    const img = imgRef.current;
    if (!viewport || !img?.naturalWidth) return;
    const fit = computeFitDimensions(
      img.naturalWidth,
      img.naturalHeight,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    if (!fit) return;
    setFitSize(fit);
    const vr = viewport.getBoundingClientRect();
    const target = {
      left: vr.left + (vr.width - fit.w) / 2,
      top: vr.top + (vr.height - fit.h) / 2,
      width: fit.w,
      height: fit.h,
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyTransition(true);
        setOverlayOpacity(1);
        setFlyRect(target);
        setFlyRadius(0);
      });
    });
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = setTimeout(() => {
      setFlyTransition(false);
      expandTimerRef.current = null;
    }, EXPAND_MS);
  }, [sourceRect]);

  /**
   * Positions the hero image at the centered fit rect (fly layout, no transform).
   */
  const snapToFlyFit = useCallback(() => {
    if (!sourceRect) {
      setLayoutMode('interactive');
      return;
    }
    const viewport = viewportRef.current;
    const size = fitSize;
    if (!viewport || !size) return;
    const vr = viewport.getBoundingClientRect();
    setFlyRect({
      left: vr.left + (vr.width - size.w) / 2,
      top: vr.top + (vr.height - size.h) / 2,
      width: size.w,
      height: size.h,
    });
    setFlyRadius(0);
    setLayoutMode('fly');
    setFlyTransition(false);
  }, [sourceRect, fitSize]);

  /**
   * Fades out then calls onClose, or plays hero collapse when sourceRect is available.
   */
  const requestClose = useCallback(() => {
    if (isClosingRef.current) return;

    if (isMobile) {
      isClosingRef.current = true;
      setIsClosing(true);
      setOverlayOpacity(0);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, FADE_MS);
      return;
    }

    const img = imgRef.current;
    const exitSource = getSourceRect?.() || sourceRect;

    if (exitSource && layoutModeRef.current === 'fly') {
      isClosingRef.current = true;
      setIsClosing(true);
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
      return;
    }

    if (exitSource && img && layoutModeRef.current === 'interactive') {
      isClosingRef.current = true;
      setIsClosing(true);
      const current = normalizeRect(img.getBoundingClientRect());
      setLayoutMode('fly');
      setFlyTransition(false);
      setFlyRect(current);
      setFlyRadius(0);
      setScale(1);
      setPan({ x: 0, y: 0 });
      panRef.current = { x: 0, y: 0 };
      setViewMode('fit');
      setLockedFitSize(null);
      setIsUnzooming(false);

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
      return;
    }

    isClosingRef.current = true;
    setIsClosing(true);
    setOverlayOpacity(0);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, overlayFadeMs);
  }, [getSourceRect, sourceRect, onClose, overlayFadeMs, isMobile]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
  }, []);

  /**
   * Returns viewport and image metrics for pan clamping.
   * @returns {{ vw: number, vh: number, iw: number, ih: number } | null}
   */
  const getViewportMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    const size = lockedFitSize || fitSize;
    if (!viewport || !size) return null;
    return {
      vw: viewport.clientWidth,
      vh: viewport.clientHeight,
      iw: size.w,
      ih: size.h,
    };
  }, [fitSize, lockedFitSize]);

  /**
   * Applies edge clamping to a pan offset at the given scale.
   * @param {{ x: number, y: number }} nextPan
   * @param {number} nextScale
   * @returns {{ x: number, y: number }}
   */
  const clampPanForScale = useCallback((nextPan, nextScale) => {
    const m = getViewportMetrics();
    if (!m) return nextPan;
    return clampPan(nextPan, m.vw, m.vh, m.iw, m.ih, nextScale);
  }, [getViewportMetrics]);

  /**
   * Writes pan to state and refs after clamping.
   * @param {{ x: number, y: number }} nextPan
   * @param {number} [nextScale]
   */
  const applyPan = useCallback((nextPan, nextScale = scaleRef.current) => {
    const clamped = clampPanForScale(nextPan, nextScale);
    panRef.current = clamped;
    setPan(clamped);
    return clamped;
  }, [clampPanForScale]);

  /**
   * Finishes the unzoom animation and clears zoom state.
   */
  const finishUnzoom = useCallback(() => {
    if (!isUnzoomingRef.current) return;
    const resetPan = { x: 0, y: 0 };
    panRef.current = resetPan;
    dragRef.current.panX = 0;
    dragRef.current.panY = 0;
    setPan(resetPan);
    setLockedFitSize(null);
    setIsUnzooming(false);
    movedRef.current = false;
    if (unzoomTimerRef.current) {
      clearTimeout(unzoomTimerRef.current);
      unzoomTimerRef.current = null;
    }
    snapToFlyFit();
  }, [snapToFlyFit]);

  /**
   * Recomputes fit dimensions from natural image size and the viewport element.
   */
  const refreshFitSize = useCallback(() => {
    const viewport = viewportRef.current;
    const img = imgRef.current;
    if (!viewport || !img?.naturalWidth) return;
    const next = computeFitDimensions(
      img.naturalWidth,
      img.naturalHeight,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    if (next) setFitSize(next);
  }, []);

  /**
   * Recomputes fit dimensions and kicks off hero enter when the image loads.
   */
  const handleImgLoad = useCallback(() => {
    refreshFitSize();
    if (hasHero) startEnterAnimation();
  }, [refreshFitSize, hasHero, startEnterAnimation]);

  useEffect(() => {
    refreshFitSize();
    const onResize = () => {
      if (!isMobile && viewMode === 'zoomed') return;
      refreshFitSize();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [refreshFitSize, isMobile, viewMode]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (unzoomTimerRef.current) clearTimeout(unzoomTimerRef.current);
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    };
  }, [requestClose]);

  /**
   * Clears desktop zoom state immediately (no animation).
   */
  const resetDesktopZoom = useCallback(() => {
    setViewMode('fit');
    setScale(1);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setLockedFitSize(null);
    setIsUnzooming(false);
    dragRef.current.panX = 0;
    dragRef.current.panY = 0;
    setIsDragging(false);
    movedRef.current = false;
  }, []);

  /**
   * Animates pan and scale together back to the fit view (reverse of zoom-in).
   */
  const animateUnzoom = useCallback(() => {
    if (!lockedFitSize) {
      resetDesktopZoom();
      return;
    }
    setIsUnzooming(true);
    setViewMode('fit');
    movedRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panRef.current = { x: 0, y: 0 };
        dragRef.current.panX = 0;
        dragRef.current.panY = 0;
        setPan({ x: 0, y: 0 });
        setScale(1);
      });
    });
    if (unzoomTimerRef.current) clearTimeout(unzoomTimerRef.current);
    unzoomTimerRef.current = setTimeout(finishUnzoom, ZOOM_ANIM_MS + 50);
  }, [lockedFitSize, resetDesktopZoom, finishUnzoom]);

  /**
   * Desktop: zoom into clicked region or unzoom. Ignored on mobile.
   * @param {React.MouseEvent<HTMLImageElement>} e
   */
  const handleImageClick = (e) => {
    if (isMobile || isUnzooming || isClosing) return;
    e.stopPropagation();
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }

    const img = imgRef.current;
    const m = getViewportMetrics();
    if (!img || !m) return;

    if (isDesktopZoomed) {
      animateUnzoom();
      return;
    }

    const rect = img.getBoundingClientRect();
    setLockedFitSize({ w: rect.width, h: rect.height });
    setViewMode('zoomed');

    const targetPan = clampPan(
      panForZoomAtPoint(e.clientX, e.clientY, m.vw, m.vh, { x: 0, y: 0 }, DESKTOP_REGIONAL_ZOOM),
      m.vw,
      m.vh,
      rect.width,
      rect.height,
      DESKTOP_REGIONAL_ZOOM,
    );

    setSuppressTransformTransition(true);
    setLayoutMode('interactive');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panRef.current = targetPan;
        dragRef.current.panX = targetPan.x;
        dragRef.current.panY = targetPan.y;
        setPan(targetPan);
        setScale(DESKTOP_REGIONAL_ZOOM);
        setSuppressTransformTransition(false);
      });
    });
  };

  /**
   * Desktop: begin tracking pointer for edge-clamped pan.
   * @param {React.PointerEvent<HTMLImageElement>} e
   */
  const handlePointerDown = (e) => {
    if (isMobile || !isDesktopZoomed || isUnzooming || isClosing || !isInteractive) return;
    e.stopPropagation();
    movedRef.current = false;
    dragRef.current = {
      pending: true,
      active: false,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  /**
   * Desktop: pan once movement exceeds click threshold; edges stay in viewport.
   * @param {React.PointerEvent<HTMLImageElement>} e
   */
  const handlePointerMove = (e) => {
    if (isMobile) return;
    const d = dragRef.current;
    if (!d.pending && !d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
      d.active = true;
      movedRef.current = true;
      setIsDragging(true);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const next = applyPan({ x: d.panX + dx, y: d.panY + dy });
    panRef.current = next;
  };

  /**
   * Desktop: end pan drag.
   * @param {React.PointerEvent<HTMLImageElement>} e
   */
  const handlePointerUp = (e) => {
    if (isMobile) return;
    const d = dragRef.current;
    if (!d.pending && !d.active) return;

    if (d.active) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const next = applyPan({ x: d.panX + dx, y: d.panY + dy });
      dragRef.current.panX = next.x;
      dragRef.current.panY = next.y;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    dragRef.current.pending = false;
    dragRef.current.active = false;
    setIsDragging(false);
  };

  /**
   * Clears unzoom state when the transform animation finishes.
   * @param {React.TransitionEvent<HTMLImageElement>} e
   */
  const handleTransitionEnd = (e) => {
    if (e.propertyName !== 'transform' || !isUnzoomingRef.current) return;
    if (scaleRef.current > 1) return;
    finishUnzoom();
  };

  /**
   * Builds inline styles for the viewport-centered image transform (desktop).
   * @returns {import('react').CSSProperties}
   */
  const getImageStyle = () => {
    if (layoutMode === 'fly' && flyRect) {
      return {
        position: 'fixed',
        left: flyRect.left,
        top: flyRect.top,
        width: flyRect.width,
        height: flyRect.height,
        objectFit: 'contain',
        display: 'block',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        transform: 'none',
        zIndex: 10001,
        borderRadius: flyRadius,
        transition: flyTransition
          ? `left ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), width ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), height ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), border-radius ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
          : 'none',
        willChange: flyTransition ? 'left, top, width, height' : 'auto',
        cursor: 'default',
      };
    }

    const base = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      display: 'block',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      objectFit: 'contain',
      transformOrigin: 'center center',
      transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
      transition: allowTransition ? `transform ${ZOOM_ANIM_MS}ms ease-out` : 'none',
      willChange: 'transform',
      cursor: isDesktopZoomed ? (isDragging ? 'grabbing' : 'grab') : 'default',
    };

    if (displaySize) {
      return {
        ...base,
        width: displaySize.w,
        height: displaySize.h,
      };
    }

    return {
      ...base,
      maxWidth: '100%',
      maxHeight: '100%',
      width: 'auto',
      height: 'auto',
      transform: 'translate(-50%, -50%)',
    };
  };

  if (isMobile) {
    const fitW = mobileFitScale && naturalSize ? naturalSize.w * mobileFitScale : null;
    const fitH = mobileFitScale && naturalSize ? naturalSize.h * mobileFitScale : null;
    const displayW = fitW != null ? fitW * mobileZoom : null;
    const displayH = fitH != null ? fitH * mobileZoom : null;

    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt || 'Expanded image'}
        onTouchEnd={handleMobileTap}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: '#000',
          opacity: overlayOpacity,
          transition: `opacity ${FADE_MS}ms ease-out`,
          overflow: 'hidden',
          pointerEvents: isClosing ? 'none' : 'auto',
        }}
      >
        <button
          type="button"
          aria-label="Close image"
          onClick={(e) => {
            e.stopPropagation();
            requestClose();
          }}
          onTouchEnd={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: 'max(8px, env(safe-area-inset-top))',
            right: 'max(8px, env(safe-area-inset-right))',
            zIndex: 10001,
            width: 36,
            height: 36,
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'rgba(255, 255, 255, 0.88)',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: mobileChromeVisible ? 1 : 0,
            transition: 'opacity 200ms ease-out',
            pointerEvents: mobileChromeVisible ? 'auto' : 'none',
          }}
        >
          ×
        </button>
        <div
          ref={mobileStageRef}
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            touchAction: 'none',
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt || ''}
            onLoad={handleMobileImgLoad}
            draggable={false}
            style={
              displayW && displayH
                ? {
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: displayW,
                    height: displayH,
                    transform: `translate(calc(-50% + ${mobilePan.x}px), calc(-50% + ${mobilePan.y}px))`,
                    willChange: 'transform',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }
                : {
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    maxWidth: '100vw',
                    maxHeight: '100dvh',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    transform: 'translate(-50%, -50%)',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }
            }
          />
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Expanded image'}
      onClick={requestClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.92)',
        boxSizing: 'border-box',
        padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
        cursor: 'default',
        opacity: overlayOpacity,
        transition: `opacity ${overlayFadeMs}ms ease-out`,
        overflow: 'hidden',
        touchAction: 'auto',
        pointerEvents: isClosing ? 'none' : 'auto',
      }}
    >
      <div
        ref={viewportRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          onLoad={handleImgLoad}
          onClick={handleImageClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onTransitionEnd={handleTransitionEnd}
          style={getImageStyle()}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  );
}
