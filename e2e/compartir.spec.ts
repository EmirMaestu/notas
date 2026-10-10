import { expect, test, type Browser, type Page } from '@playwright/test';

/** Registra un usuario en un contexto de navegador propio (cookies separadas) y devuelve su página. */
async function register(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/registro');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/today/);
  return page;
}

test('compartir una lista, crear una tarea como miembro, asignarla y salir de la lista', async ({ browser }) => {
  test.setTimeout(180_000); // dos contextos y varias rondas de compilación en frío del servidor de desarrollo
  const stamp = Date.now();
  const ownerEmail = `duenio-${stamp}@example.com`;
  const memberEmail = `miembro-${stamp}@example.com`;
  const owner = await register(browser, ownerEmail);
  const member = await register(browser, memberEmail);

  // El dueño crea la lista y agrega al miembro por email.
  await owner.getByRole('button', { name: 'Nueva lista' }).click();
  await owner.getByLabel('Nombre de la lista').fill('Compras');
  await owner.getByRole('button', { name: 'Guardar' }).click();
  await expect(owner).toHaveURL(/\/app\/list\//);
  await owner.getByRole('link', { name: 'Compras', exact: true }).hover();
  await owner.getByRole('button', { name: 'Editar Compras' }).click();
  await owner.getByLabel('Email del nuevo miembro').fill(memberEmail);
  await owner.getByRole('button', { name: 'Invitar' }).click();
  await expect(owner.getByRole('dialog').getByText(memberEmail)).toBeVisible();
  await owner.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // El miembro la ve en "Compartidas conmigo" y crea una tarea.
  await member.reload();
  await expect(member.getByText('Compartidas conmigo')).toBeVisible();
  await member.getByRole('link', { name: 'Compras', exact: true }).click();
  await expect(member).toHaveURL(/\/app\/list\//);
  await member.getByLabel('Nueva tarea').fill('Comprar leche');
  await member.getByLabel('Nueva tarea').press('Enter');
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toBeVisible();

  // El dueño la ve y se la asigna al miembro.
  await owner.reload();
  await owner.getByRole('link', { name: /Comprar leche/ }).click();
  const assignee = owner.getByLabel('Asignada a');
  await expect(assignee).toBeVisible();
  await expect(assignee).toBeEnabled();
  await expect(assignee.locator('option', { hasText: memberEmail })).toHaveCount(1);
  await assignee.selectOption({ label: memberEmail });
  await expect(owner.getByRole('link', { name: /Comprar leche.*Asignada a/ })).toBeVisible();

  // El miembro la encuentra en "Asignadas a mí".
  // En desarrollo el primer clic puede perderse mientras la ruta compila: se reintenta.
  await expect(async () => {
    await member.getByRole('link', { name: 'Asignadas a mí' }).click();
    await expect(member).toHaveURL(/\/app\/assigned/, { timeout: 20_000 });
  }).toPass({ timeout: 100_000 });
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toBeVisible();

  // Sale de la lista: deja de verla y la asignación se limpia.
  await member.getByRole('link', { name: 'Compras', exact: true }).hover();
  await member.getByRole('button', { name: 'Miembros de Compras' }).click();
  await member.getByRole('button', { name: 'Salir de la lista' }).click();
  await member.getByRole('alertdialog').getByRole('button', { name: 'Salir de la lista' }).click();
  await expect(member.getByText('Compartidas conmigo')).toHaveCount(0);
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toHaveCount(0);

  await owner.context().close();
  await member.context().close();
});
