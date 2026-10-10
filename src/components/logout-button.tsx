'use client';

import { LogOut } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { btn } from './ui';

export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${btn.secondary} h-[38px] px-3.5 text-[13px]`}>
      <LogOut size={14} aria-hidden="true" />
      {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  );
}
