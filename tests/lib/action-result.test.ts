import { notFound, redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '@/core/errors';
import { runAction } from '@/lib/action-result';

describe('runAction', () => {
  it('éxito', async () => {
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 });
  });
  it('errores de dominio se devuelven como texto', async () => {
    expect(await runAction(async () => { throw new ValidationError('Fecha inválida'); }))
      .toEqual({ ok: false, error: 'Fecha inválida' });
    expect(await runAction(async () => { throw new NotFoundError('La tarea'); }))
      .toEqual({ ok: false, error: 'La tarea no existe' });
  });
  it('errores inesperados se ocultan y se loguean', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runAction(async () => { throw new Error('connection refused 10.0.0.5'); });
    expect(result).toEqual({ ok: false, error: 'Ocurrió un error inesperado. Probá de nuevo.' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('re-lanza redirect/notFound de Next.js', async () => {
    await expect(runAction(async () => redirect('/login'))).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });
    await expect(runAction(async () => notFound())).rejects.toBeDefined();
  });
});
