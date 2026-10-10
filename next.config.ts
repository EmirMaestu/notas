import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los e2e usan otro distDir para no pisar el .next del servidor de desarrollo.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  poweredByHeader: false,
  // El runtime lee las migraciones de ./drizzle; .data es la base local de desarrollo y no debe viajar.
  outputFileTracingIncludes: { '*': ['./drizzle/**/*'] },
  outputFileTracingExcludes: { '*': ['./.data/**/*'] },
  serverExternalPackages: ['@electric-sql/pglite'],
  // Nadie puede embeber la app en un iframe (protege el botón "Permitir" del consentimiento OAuth).
  async headers() {
    const noReferrer = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      // Estas URLs llevan en la query client_id, state, code_challenge o ?next=: no deben filtrarse por Referer.
      { source: '/oauth/:path*', headers: noReferrer },
      { source: '/login', headers: noReferrer },
      { source: '/registro', headers: noReferrer },
    ];
  },
};

export default nextConfig;
