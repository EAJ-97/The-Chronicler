import { useContext } from 'react';
import { ThemeContext } from './ThemeContext.jsx';

/**
 * Returns the applied site-wide theme and related helpers.
 * @returns {import('./ThemeContext.jsx').ThemeContextValue}
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
