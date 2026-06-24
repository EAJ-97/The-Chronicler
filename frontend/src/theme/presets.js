import { CHRONICLER_DEFAULT } from './chroniclerDefault.js';
import { cloneTheme } from './schema.js';

/**
 * Built-in theme presets. Each is a full token snapshot derived from the default.
 * @type {Array<{ id: string, name: string, description: string, theme: import('./schema.js').ChroniclerTheme }>}
 */
export const THEME_PRESETS = [
  {
    id: 'chronicler',
    name: 'The Chronicler',
    description: 'Classic dark fantasy — gold accents and parchment text.',
    theme: cloneTheme(CHRONICLER_DEFAULT),
  },
  {
    id: 'obsidian',
    name: 'Obsidian Night',
    description: 'Cool blue-grays with silver accent.',
    theme: {
      ...cloneTheme(CHRONICLER_DEFAULT),
      presetId: 'obsidian',
      colors: {
        ...CHRONICLER_DEFAULT.colors,
        shellBg: '#050608',
        panelBg: '#080b12',
        cardBg: '#0c1018',
        topbarBg: '#080b12',
        textPrimary: '#d8e4f0',
        textMuted: 'rgba(200,215,230,0.5)',
        textAccent: 'rgba(180,200,220,0.9)',
        accent: '#8eb4d4',
        accentDim: '#5a8aaa',
        border: 'rgba(142,180,212,0.12)',
        borderStrong: 'rgba(142,180,212,0.22)',
        scrollTrack: '#0a0e14',
        scrollThumb: '#2a3548',
        graphBg: '#050608',
      },
      edges: {
        canon: { color: '#8eb4d4', brightness: 0.22 },
        theory: { color: '#7a6ec8', brightness: 0.24 },
        ship: { color: '#c070a8', brightness: 0.24 },
      },
    },
  },
  {
    id: 'ember',
    name: 'Ember Hearth',
    description: 'Warm browns, amber glow, deeper reds.',
    theme: {
      ...cloneTheme(CHRONICLER_DEFAULT),
      presetId: 'ember',
      colors: {
        ...CHRONICLER_DEFAULT.colors,
        shellBg: '#0a0604',
        panelBg: '#120c08',
        cardBg: '#181008',
        topbarBg: '#120c08',
        textPrimary: '#f0dcc8',
        textMuted: 'rgba(220,190,160,0.55)',
        textAccent: 'rgba(220,140,60,0.9)',
        accent: '#d4842a',
        accentDim: '#a06018',
        border: 'rgba(212,132,42,0.14)',
        borderStrong: 'rgba(212,132,42,0.24)',
        scrollTrack: '#140e0a',
        scrollThumb: '#3a2820',
        graphBg: '#0a0604',
      },
      categories: {
        ...CHRONICLER_DEFAULT.categories,
        faction: '#a02828',
      },
      edges: {
        canon: { color: '#d4842a', brightness: 0.22 },
        theory: { color: '#b060c0', brightness: 0.24 },
        ship: { color: '#d04060', brightness: 0.24 },
      },
    },
  },
  {
    id: 'verdant',
    name: 'Verdant Tome',
    description: 'Forest greens with moss-toned parchment.',
    theme: {
      ...cloneTheme(CHRONICLER_DEFAULT),
      presetId: 'verdant',
      colors: {
        ...CHRONICLER_DEFAULT.colors,
        shellBg: '#040806',
        panelBg: '#080f0a',
        cardBg: '#0c1410',
        topbarBg: '#080f0a',
        textPrimary: '#d4e8c8',
        textMuted: 'rgba(190,220,170,0.5)',
        textAccent: 'rgba(120,200,100,0.9)',
        accent: '#5cb86a',
        accentDim: '#3a8848',
        border: 'rgba(92,184,106,0.14)',
        borderStrong: 'rgba(92,184,106,0.24)',
        scrollTrack: '#0a120c',
        scrollThumb: '#2a4030',
        graphBg: '#040806',
      },
      categories: {
        ...CHRONICLER_DEFAULT.categories,
        lore: '#6a9a40',
        event: '#40a878',
      },
      edges: {
        canon: { color: '#5cb86a', brightness: 0.22 },
        theory: { color: '#70a0c8', brightness: 0.24 },
        ship: { color: '#c878a0', brightness: 0.24 },
      },
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'Strong separation for readability.',
    theme: {
      ...cloneTheme(CHRONICLER_DEFAULT),
      presetId: 'high-contrast',
      colors: {
        ...CHRONICLER_DEFAULT.colors,
        shellBg: '#000000',
        panelBg: '#0a0a0a',
        cardBg: '#141414',
        topbarBg: '#0a0a0a',
        textPrimary: '#ffffff',
        textMuted: 'rgba(255,255,255,0.7)',
        textAccent: '#ffcc66',
        accent: '#ffcc00',
        accentDim: '#cc9900',
        border: 'rgba(255,204,0,0.25)',
        borderStrong: 'rgba(255,204,0,0.45)',
        scrollTrack: '#111111',
        scrollThumb: '#555555',
        graphBg: '#000000',
      },
      edges: {
        canon: { color: '#ffcc00', brightness: 0.35 },
        theory: { color: '#cc88ff', brightness: 0.35 },
        ship: { color: '#ff66aa', brightness: 0.35 },
      },
    },
  },
];

/**
 * Finds a preset by id.
 * @param {string} id
 * @returns {typeof THEME_PRESETS[number] | undefined}
 */
export function getPresetById(id) {
  return THEME_PRESETS.find((p) => p.id === id);
}
