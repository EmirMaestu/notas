import { useEffect, useRef, useState } from 'react';

/**
 * Valor local de un campo cuando llega un valor nuevo del servidor: si el campo no está sucio (lo que se ve
 * sigue siendo la base anterior) se adopta el valor del servidor; si el usuario ya empezó a editar, se conserva.
 */
export function nextLocalValue(local: string, previousBaseline: string, server: string): string {
  return local === previousBaseline ? server : local;
}

/**
 * Campo de texto editable con una "base del servidor": el último valor conocido del servidor (o guardado por
 * este cliente). Un cambio remoto (AutoRefresh) se refleja en el campo mientras no esté sucio, y al salir
 * del campo solo se guarda si difiere de la base, de modo que un renombrado remoto nunca se revierte.
 */
export function useSyncedField(server: string) {
  const [value, setValue] = useState(server);
  const baseline = useRef(server);

  useEffect(() => {
    const previous = baseline.current;
    if (server === previous) return;
    baseline.current = server;
    setValue((local) => nextLocalValue(local, previous, server));
  }, [server]);

  return { value, setValue, baseline };
}
