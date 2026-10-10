/** Preferencia de tema: `system` sigue a `prefers-color-scheme`; `light`/`dark` la fijan. */
export const THEME_COOKIE = 'notas-theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export function parseTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
