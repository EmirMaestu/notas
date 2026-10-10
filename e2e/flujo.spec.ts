import { expect, test } from '@playwright/test';

test('registro, tarea con agregado rápido, detalle, completar y papelera', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto('/registro');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/today/);

  await page.getByLabel('Nueva tarea').fill('Comprar pan !alta #super');
  await page.getByLabel('Nueva tarea').press('Enter');
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'super', exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Comprar pan/ }).click();
  await page.getByLabel('Nueva subtarea').fill('Integral');
  await page.getByLabel('Nueva subtarea').press('Enter');
  await expect(page.getByLabel('Editar subtarea 1')).toHaveValue('Integral');

  // Sin confirmación: la fila sale y un toast ofrece «Deshacer».
  await page.getByRole('button', { name: 'Mandar a la papelera' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tarea enviada a la papelera' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Papelera' }).click();
  await page.getByRole('link', { name: /Comprar pan/ }).click();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Hoy', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Completar "/ }).first().click();
  await expect(page.getByRole('checkbox', { name: /^Marcar ".*" como pendiente/ })).toBeVisible();
  // Pasado el margen de 600 ms para deshacer se guarda y la fila sale de Hoy: recién ahí se navega.
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Completadas' }).click();
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toBeVisible();

  await page.getByRole('link', { name: 'Configuración' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/app/today');
  await expect(page).toHaveURL(/\/login/);
});
