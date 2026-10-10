/** Clases del sistema de diseño. Cada uso agrega alto, padding horizontal y tamaño de letra. */
export const btn = {
  /** Primario: fondo acento, 700. */
  primary:
    'inline-flex items-center justify-center gap-2 rounded-input bg-accent font-bold text-accent-fg transition-colors duration-120 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50',
  /** Secundario: borde, superficie, 600. */
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-input border border-line bg-surface font-semibold text-fg transition-colors duration-120 hover:bg-hover disabled:pointer-events-none disabled:opacity-50',
  /** Peligro lleno (confirmaciones). */
  danger:
    'inline-flex items-center justify-center gap-2 rounded-input bg-danger font-bold text-white transition-[filter] duration-120 hover:brightness-95 disabled:pointer-events-none disabled:opacity-50',
  /** Peligro fantasma («Mandar a la papelera», «Borrar lista»). */
  ghostDanger:
    'inline-flex items-center gap-[7px] rounded-input font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:pointer-events-none disabled:opacity-50',
  /** Botón de ícono (X, ←, menú). */
  icon:
    'inline-flex shrink-0 items-center justify-center rounded-nav text-muted transition-colors duration-120 hover:bg-hover hover:text-fg',
};

/**
 * Campo de texto/select: borde, foco con anillo `--selected`, error con borde de peligro. Agregar alto, fondo y
 * `font-normal` (dentro de un <label> en 600 el input heredaría el peso). Sin color de texto: hereda `--fg`
 * y se puede atenuar (p. ej. «Sin carpeta») sin chocar con otra clase de color.
 */
export const field =
  'w-full rounded-input border border-line px-3 text-body outline-none transition-[border-color,box-shadow] duration-120 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--selected)] focus-visible:outline-none aria-[invalid=true]:border-danger disabled:bg-hover disabled:opacity-55';

/** Rótulo de sección dentro de paneles: 12 / 700 / +6 % / mayúsculas. */
export const sectionLabel = 'text-[12px] font-bold uppercase tracking-[.06em] text-muted';
