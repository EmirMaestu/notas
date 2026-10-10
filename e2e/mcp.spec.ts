import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { mcpCall, mcpStatus, toolJson } from './mcp-helpers';

const BASE = 'http://localhost:3100';
const RESOURCE = `${BASE}/mcp`;

async function fillRegistration(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

test('token personal: se crea en Configuración, opera por MCP y se revoca', async ({ page, request }) => {
  await page.goto('/registro');
  await fillRegistration(page, `mcp-${Date.now()}@example.com`);
  await expect(page).toHaveURL(/\/app\/today/);

  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.locator('code[aria-label="URL del servidor MCP"]')).toHaveText(RESOURCE);
  await page.getByLabel('Nombre del token').fill('e2e');
  await page.getByRole('button', { name: 'Crear token' }).click();
  const tokenBox = page.locator('code[aria-label="Token nuevo"]');
  await expect(tokenBox).toHaveText(/^ntk_/);
  const token = (await tokenBox.textContent())!.trim();
  await expect(page.getByRole('button', { name: 'Revocar token e2e' })).toBeVisible();

  const init = await mcpCall(request, token, 1, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0.0' },
  });
  expect(init.result?.protocolVersion).toBe('2025-06-18');
  const tools = await mcpCall(request, token, 2, 'tools/list');
  expect(tools.result?.tools?.map((t) => t.name)).toContain('create_task');
  const created = await mcpCall(request, token, 3, 'tools/call', {
    name: 'create_task', arguments: { title: 'Desde la IA', priority: 5 },
  });
  expect(toolJson(created)).toMatchObject({ title: 'Desde la IA', list_name: 'Bandeja', priority: 5 });

  await page.getByRole('link', { name: 'Bandeja' }).click();
  await expect(page.getByRole('link', { name: /Desde la IA/ })).toBeVisible();

  await page.getByRole('link', { name: 'Configuración' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revocar token e2e' }).click();
  await expect(page.getByRole('button', { name: 'Revocar token e2e' })).toHaveCount(0);
  expect(await mcpStatus(request, token)).toBe(401);
});

test('OAuth: registro dinámico, alta con consentimiento, token, MCP, refresh y reuso del código', async ({ page, request }) => {
  const redirectUri = 'http://127.0.0.1:4999/callback';
  const registered = await request.post('/oauth/register', {
    data: { client_name: 'Cliente e2e', redirect_uris: [redirectUri] },
  });
  expect(registered.status()).toBe(201);
  const clientId = (await registered.json()).client_id as string;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'estado-e2e', scope: 'tasks', resource: RESOURCE,
  });
  // El "cliente" no existe: se intercepta la vuelta a su redirect_uri.
  await page.route('http://127.0.0.1:4999/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'listo' }));

  // Sin sesión: login → "Registrate" conserva next → vuelve al consentimiento.
  await page.goto(`/oauth/authorize?${query}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole('link', { name: 'Registrate' }).click();
  await expect(page).toHaveURL(/\/registro\?next=/);
  await fillRegistration(page, `oauth-${Date.now()}@example.com`);
  await expect(page.getByRole('heading', { name: 'Cliente e2e quiere acceder a tu cuenta de Notas' })).toBeVisible();
  await expect(page.getByText('127.0.0.1:4999').first()).toBeVisible();
  await page.getByRole('button', { name: 'Permitir' }).click();

  await page.waitForURL(/127\.0\.0\.1:4999\/callback/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe('estado-e2e');
  expect(callback.searchParams.get('iss')).toBe(BASE);
  const code = callback.searchParams.get('code');
  expect(code).toMatch(/^nac_/);

  const exchange = {
    grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: redirectUri,
    code_verifier: verifier, resource: RESOURCE,
  };
  const tokenRes = await request.post('/oauth/token', { form: exchange });
  expect(tokenRes.status()).toBe(200);
  const tokens = await tokenRes.json();
  expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'tasks', expires_in: 3600 });

  const created = await mcpCall(request, tokens.access_token, 1, 'tools/call', {
    name: 'create_task', arguments: { title: 'Vía OAuth' },
  });
  expect(toolJson(created)).toMatchObject({ title: 'Vía OAuth' });

  // La app aparece conectada en Configuración.
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'Desconectar Cliente e2e' })).toBeVisible();

  // Refresh con rotación: el access token viejo deja de servir.
  const refreshed = await request.post('/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, resource: RESOURCE },
  });
  expect(refreshed.status()).toBe(200);
  const next = await refreshed.json();
  expect(await mcpStatus(request, tokens.access_token)).toBe(401);
  expect(await mcpStatus(request, next.access_token)).toBe(200);

  // Reusar el código revoca todo lo que se emitió con él.
  const reused = await request.post('/oauth/token', { form: exchange });
  expect(reused.status()).toBe(400);
  expect(await reused.json()).toMatchObject({ error: 'invalid_grant' });
  expect(await mcpStatus(request, next.access_token)).toBe(401);
});
