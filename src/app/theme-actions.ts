'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme, type ThemePreference } from '@/lib/theme';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Guarda la preferencia en una cookie: la lee el layout raíz para poner `data-theme` sin parpadeo. */
export async function setThemeAction(value: ThemePreference): Promise<void> {
  const theme = parseTheme(value);
  const store = await cookies();
  if (theme === 'system') {
    store.delete(THEME_COOKIE);
    return;
  }
  store.set(THEME_COOKIE, theme, {
    path: '/', maxAge: ONE_YEAR, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production',
  });
}
