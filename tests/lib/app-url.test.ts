import { afterEach, describe, expect, it, vi } from 'vitest';
import { appUrl, mcpResourceUrl, protectedResourceMetadataUrl } from '@/lib/app-url';

describe('appUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('usa APP_URL sin barra final y arma las URLs derivadas', () => {
    vi.stubEnv('APP_URL', 'https://Notas.Example.com/');
    expect(appUrl()).toBe('https://notas.example.com');
    expect(mcpResourceUrl()).toBe('https://notas.example.com/mcp');
    expect(protectedResourceMetadataUrl()).toBe('https://notas.example.com/.well-known/oauth-protected-resource/mcp');
  });

  it('en desarrollo, sin APP_URL, usa http://localhost:3000', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(appUrl()).toBe('http://localhost:3000');
  });

  it('en producción exige APP_URL', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => appUrl()).toThrow('APP_URL');
  });

  it('rechaza valores que no son esquema + host', () => {
    vi.stubEnv('APP_URL', 'notas.example.com');
    expect(() => appUrl()).toThrow('APP_URL');
    vi.stubEnv('APP_URL', 'https://notas.example.com/base');
    expect(() => appUrl()).toThrow('APP_URL');
    vi.stubEnv('APP_URL', 'ftp://notas.example.com');
    expect(() => appUrl()).toThrow('APP_URL');
  });
});
