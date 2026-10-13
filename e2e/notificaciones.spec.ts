import { expect, test } from '@playwright/test';

test('notificaciones: /sw.js, recordatorio en el detalle y preferencias en Configuración', async ({ page, request }) => {
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['cache-control']).toMatch(/no-cache|no-store/);
  expect(await sw.text()).toContain('notificationclick');

  const email = `e2e-avisos-${Date.now()}@example.com`;
  await page.goto('/registro');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/today/);

  // En «Hoy» el agregado rápido pone la fecha de hoy (sin hora): opciones «el mismo día» / «el día anterior».
  await page.getByLabel('Nueva tarea').fill('Pagar la luz');
  await page.getByLabel('Nueva tarea').press('Enter');
  await page.getByRole('link', { name: /Pagar la luz/ }).click();
  const reminder = page.getByLabel('Recordatorio', { exact: true });
  await expect(reminder).toBeEnabled();
  await reminder.selectOption({ label: 'El día anterior a las 09:00' });
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel('Recordatorio', { exact: true })).toHaveValue('day_before', { timeout: 3_000 });
  }).toPass();

  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  await expect(page.getByText(/no están configuradas en este servidor/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activar en este dispositivo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();

  await page.getByLabel('Recordatorio por defecto').selectOption({ label: '15 minutos antes' });
  await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Resumen diario' }).check();
  await expect(page.getByLabel('Hora del resumen diario')).toBeEnabled();
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel('Recordatorio por defecto')).toHaveValue('15', { timeout: 3_000 });
    await expect(page.getByRole('checkbox', { name: 'Resumen diario' })).toBeChecked({ timeout: 3_000 });
  }).toPass();
});
