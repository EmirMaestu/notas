'use client';

import { useSyncExternalStore } from 'react';

/**
 * `matchMedia` como estado de React. En el servidor y durante la hidratación devuelve `serverValue`
 * (sin desajustes); después se corrige solo.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
