'use client';

import { useFormStatus } from 'react-dom';

export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-60">
      {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  );
}
