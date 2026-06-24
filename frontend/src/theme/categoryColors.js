import { CHRONICLER_DEFAULT } from './chroniclerDefault.js';

/** @type {import('./schema.js').ChroniclerTheme['categories']} */
let currentCategories = { ...CHRONICLER_DEFAULT.categories };

/**
 * Updates in-memory category colors for non-React modules (graph elements).
 * @param {import('./schema.js').ChroniclerTheme['categories']} categories
 */
export function setCategoryColors(categories) {
  currentCategories = { ...categories };
}

/**
 * Returns the current category color for graph and legacy call sites.
 * @param {string} cat
 * @returns {string}
 */
export function getCategoryColor(cat) {
  return currentCategories[cat] || currentCategories.general;
}
