import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap',
});
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = { title: 'Notas', description: 'Tus tareas, tuyas y de la IA' };
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F5F1' },
    { media: '(prefers-color-scheme: dark)', color: '#161513' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El tema manual llega en la cookie: se resuelve en el servidor para no parpadear al cargar.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="es" data-theme={theme === 'system' ? undefined : theme}
      className={`${manrope.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
