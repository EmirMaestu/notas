import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as authorizationServer } from '@/app/.well-known/oauth-authorization-server/route';
import { OPTIONS, GET as protectedResourceRoot } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as protectedResourceMcp } from '@/app/.well-known/oauth-protected-resource/mcp/route';

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://notas.test');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/.well-known', () => {
  it('metadata del recurso (RFC 9728) en la raíz y en /mcp', async () => {
    for (const handler of [protectedResourceRoot, protectedResourceMcp]) {
      const res = handler();
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.json()).toEqual({
        resource: 'https://notas.test/mcp',
        authorization_servers: ['https://notas.test'],
        scopes_supported: ['tasks'],
        bearer_methods_supported: ['header'],
        resource_name: 'Notas',
      });
    }
  });

  it('metadata del servidor de autorización (RFC 8414)', async () => {
    const res = authorizationServer();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: 'https://notas.test',
      authorization_endpoint: 'https://notas.test/oauth/authorize',
      token_endpoint: 'https://notas.test/oauth/token',
      registration_endpoint: 'https://notas.test/oauth/register',
      revocation_endpoint: 'https://notas.test/oauth/revoke',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['tasks'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('responde el preflight CORS', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
