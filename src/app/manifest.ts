import type { MetadataRoute } from 'next';

// Permite instalar Notas como app (Android/escritorio: "Instalar app"; iPhone: "Agregar a inicio").
// Los íconos se generan con `node scripts/generate-icons.mjs` a partir de assets/icon/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Notas',
    short_name: 'Notas',
    description: 'Tus tareas, tuyas y de la IA',
    start_url: '/app/today',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F5F1',
    theme_color: '#15697B',
    lang: 'es',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
