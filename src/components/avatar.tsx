import { avatarTone, initials } from '@/lib/initials';

export type AvatarSize = 18 | 20 | 22 | 24 | 26 | 28 | 30 | 36;

const TEXT: Record<AvatarSize, string> = {
  18: 'text-[9px]', 20: 'text-[9px]', 22: 'text-[10px]', 24: 'text-[10px]',
  26: 'text-[10px]', 28: 'text-[11px]', 30: 'text-[12px]', 36: 'text-[14px]',
};

/**
 * Círculo con las iniciales y un tono estable por persona (hash del id → 1 de 6).
 * Decorativo: quien lo usa agrega el texto accesible. `ring` lo separa del fondo en una pila.
 */
export function Avatar({
  person, size = 24, ring = false,
}: { person: { id?: string; name: string; email: string }; size?: AvatarSize; ring?: boolean }) {
  return (
    <span
      title={person.name || person.email} aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-av-fg ${TEXT[size]} ${ring ? 'border-2 border-bg' : ''}`}
      style={{ width: size, height: size, backgroundColor: `var(--av-${avatarTone(person.id ?? person.email)})` }}
    >
      {initials(person)}
    </span>
  );
}
