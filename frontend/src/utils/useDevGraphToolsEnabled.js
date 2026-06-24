import { useState, useEffect } from 'react';
import api from '../api.js';
import { isDevSite } from './isDevSite.js';

/**
 * Resolves whether dev graph tools should show (port, localStorage, or /api/version dev flag).
 * @returns {boolean}
 */
export function useDevGraphToolsEnabled() {
  const [enabled, setEnabled] = useState(() => isDevSite());

  useEffect(() => {
    if (enabled) return undefined;
    let cancelled = false;
    api.get('/version')
      .then((res) => {
        if (!cancelled && res.data?.dev) setEnabled(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled;
}
