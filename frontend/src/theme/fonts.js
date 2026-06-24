/**
 * Curated Google Font options per typography role.
 */
export const FONT_OPTIONS = {
  body: [
    'Crimson Pro',
    'Lora',
    'Merriweather',
    'Source Serif 4',
    'Libre Baskerville',
    'EB Garamond',
  ],
  display: [
    'Cinzel',
    'Cormorant Garamond',
    'EB Garamond',
    'Playfair Display',
    'Spectral',
    'Crimson Pro',
  ],
  brand: [
    'Cinzel Decorative',
    'UnifrakturMaguntia',
    'MedievalSharp',
    'Cinzel',
    'Cormorant Garamond',
  ],
};

const GOOGLE_FAMILIES = {
  'Crimson Pro': 'family=Crimson+Pro:ital,wght@0,300;0,400;0,500;1,300;1,400',
  Lora: 'family=Lora:ital,wght@0,400;0,500;0,600;1,400',
  Merriweather: 'family=Merriweather:ital,wght@0,300;0,400;0,700;1,400',
  'Source Serif 4': 'family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400',
  'Libre Baskerville': 'family=Libre+Baskerville:ital,wght@0,400;0,700;1,400',
  'EB Garamond': 'family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400',
  Cinzel: 'family=Cinzel:wght@400;500;600;700',
  'Cormorant Garamond': 'family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Playfair Display': 'family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400',
  Spectral: 'family=Spectral:ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Cinzel Decorative': 'family=Cinzel+Decorative:wght@400;700',
  UnifrakturMaguntia: 'family=UnifrakturMaguntia',
  MedievalSharp: 'family=MedievalSharp',
};

const LINK_ID = 'chronicler-theme-fonts';

/**
 * Loads Google Fonts needed for the given font families (deduped).
 * @param {string[]} families
 */
export function loadThemeFonts(families) {
  const unique = [...new Set(families.filter(Boolean))];
  const params = unique
    .map((f) => GOOGLE_FAMILIES[f])
    .filter(Boolean);
  if (!params.length) return;

  let link = document.getElementById(LINK_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
}

/**
 * Loads fonts for a full theme object.
 * @param {import('./schema.js').ChroniclerTheme} theme
 */
export function loadFontsForTheme(theme) {
  loadThemeFonts([theme.fonts.body, theme.fonts.display, theme.fonts.brand]);
}
