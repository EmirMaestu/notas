import { ValidationError } from './errors';

/** Módulo puro (sin base de datos): lo usan tanto el núcleo como los componentes de cliente. */
export function normalizeTagName(name: string): string {
  const clean = name.trim().replace(/^#+/, '').toLowerCase();
  if (!clean) throw new ValidationError('El nombre de la etiqueta no puede estar vacío');
  if (clean.length > 50) throw new ValidationError('El nombre de la etiqueta no puede superar los 50 caracteres');
  if (/[,#]/.test(clean)) throw new ValidationError(`La etiqueta "${clean}" no puede contener "," ni "#"`);
  if (/\s/.test(clean)) throw new ValidationError(`La etiqueta "${clean}" no puede tener espacios`);
  return clean;
}
