import { initials } from '@/lib/initials';

/** Círculo con las iniciales de una persona. Decorativo: quien lo usa agrega el texto accesible. */
export function Avatar({ person, size = 'md' }: { person: { name: string; email: string }; size?: 'sm' | 'md' }) {
  return (
    <span
      title={person.name || person.email} aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg ${size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-[11px]'}`}
    >
      {initials(person)}
    </span>
  );
}
