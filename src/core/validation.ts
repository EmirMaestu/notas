import { ValidationError } from './errors';

/** Valida un color #rrggbb. Vacío se normaliza a null; undefined se respeta (= no tocar). */
export function checkColor(color: string | null | undefined): string | null | undefined {
  if (color === undefined) return undefined;
  if (color === null || color === '') return null;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ValidationError(`Color inválido: ${color} (usá formato #rrggbb)`);
  return color;
}
