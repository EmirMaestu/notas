import { beforeEach, describe, expect, it } from 'vitest';
import {
  OAuthError, getClient, isAllowedRedirectUri, isLoopbackRedirect, matchesRegisteredRedirect, registerClient,
  sameResource,
} from '@/core/oauth';
import type { DB } from '@/db/types';
import { createTestDb } from '../helpers/db';
import { REDIRECT, RESOURCE } from '../helpers/oauth';

describe('redirect URIs', () => {
  it('acepta https y http solo hacia la propia máquina', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:8080/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://x.example.com/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('https://user:pw@x.example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('cursor://anysphere/callback')).toBe(false);
    expect(isAllowedRedirectUri('no es una url')).toBe(false);
    expect(isAllowedRedirectUri(42)).toBe(false);
  });

  it('isLoopbackRedirect solo para http a la propia máquina', () => {
    expect(isLoopbackRedirect('http://127.0.0.1:4999/callback')).toBe(true);
    expect(isLoopbackRedirect('http://localhost/cb')).toBe(true);
    expect(isLoopbackRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });

  it('compara exacto, salvo loopback http, donde ignora el puerto', () => {
    const registered = [
      'https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1:5000/cb?x=1',
    ];
    expect(matchesRegisteredRedirect(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(matchesRegisteredRedirect(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(matchesRegisteredRedirect(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(matchesRegisteredRedirect(registered, 'http://localhost:3118/callback')).toBe(true);
    expect(matchesRegisteredRedirect(registered, 'http://localhost:3118/otra')).toBe(false);
    expect(matchesRegisteredRedirect(registered, 'http://127.0.0.1:9999/cb?x=1')).toBe(true);
    expect(matchesRegisteredRedirect(registered, 'http://127.0.0.1:9999/cb')).toBe(false);
    expect(matchesRegisteredRedirect(registered, 'https://localhost:3118/callback')).toBe(false);
    expect(matchesRegisteredRedirect(registered, 'http://evil.example.com/callback')).toBe(false);
  });
});

describe('sameResource', () => {
  it('tolera mayúsculas en esquema/host, puerto por defecto y barra final', () => {
    expect(sameResource('https://notas.test/mcp', RESOURCE)).toBe(true);
    expect(sameResource('HTTPS://NOTAS.TEST/mcp/', RESOURCE)).toBe(true);
    expect(sameResource('https://notas.test:443/mcp', RESOURCE)).toBe(true);
  });

  it('distingue otro host, otra ruta, fragmentos y basura', () => {
    expect(sameResource('https://notas.test', RESOURCE)).toBe(false);
    expect(sameResource('https://otro.test/mcp', RESOURCE)).toBe(false);
    expect(sameResource('https://notas.test/mcp#x', RESOURCE)).toBe(false);
    expect(sameResource('basura', RESOURCE)).toBe(false);
  });
});

describe('registro de clientes', () => {
  let db: DB;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('registra un cliente público con id ncl_, nombre limpio y redirects sin repetir', async () => {
    const client = await registerClient(db, {
      client_name: '  Claude\u0000 ',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
    });
    expect(client.clientId).toMatch(/^ncl_[A-Za-z0-9_-]{22}$/);
    expect(client.clientName).toBe('Claude');
    expect(client.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(await getClient(db, client.clientId)).toEqual(client);
  });

  it('sin nombre usa uno genérico', async () => {
    const client = await registerClient(db, { redirect_uris: [REDIRECT] });
    expect(client.clientName).toBe('Aplicación sin nombre');
  });

  it('rechaza metadata inválida con el código OAuth correspondiente', async () => {
    await expect(registerClient(db, null)).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(registerClient(db, [REDIRECT])).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(registerClient(db, {})).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(registerClient(db, { redirect_uris: [] })).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(registerClient(db, { redirect_uris: ['http://evil.example.com/cb'] }))
      .rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(registerClient(db, {
      redirect_uris: Array.from({ length: 11 }, (_, i) => `https://x.example.com/${i}`),
    })).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(registerClient(db, { client_name: 5, redirect_uris: [REDIRECT] })).rejects.toBeInstanceOf(OAuthError);
  });

  it('getClient: desconocido o con formato raro → null', async () => {
    expect(await getClient(db, 'ncl_noexiste')).toBeNull();
    expect(await getClient(db, 'otro-formato')).toBeNull();
  });
});
