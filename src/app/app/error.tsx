'use client';

import { CloudOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';

/** Error al cargar una vista (la barra lateral queda): «Probá de nuevo» vuelve a pedir los datos. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <div className="flex h-full items-center justify-center p-4">
      <EmptyState
        icon={CloudOff} title="No pudimos cargar tus tareas" body="Revisá la conexión y volvé a intentar."
        action={{
          label: 'Probá de nuevo', variant: 'secondary',
          onClick: () => startTransition(() => { router.refresh(); reset(); }),
        }}
      />
    </div>
  );
}
