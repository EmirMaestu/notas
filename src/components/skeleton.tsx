const ROWS: [string, number][] = [['62%', 36], ['45%', 50], ['72%', 28]];

export function TaskListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando tareas" className="flex flex-col gap-3.5 pt-5">
      <div className="mx-3.5 h-3.5 w-[90px] animate-skeleton rounded-chip bg-skeleton" />
      {ROWS.map(([width, end], i) => (
        <div key={i} className="flex h-11 items-center gap-3.5 px-3.5">
          <span className="h-5 w-5 shrink-0 animate-skeleton rounded-full bg-skeleton" />
          <span className="h-3 flex-1 animate-skeleton rounded-chip bg-skeleton" style={{ maxWidth: width }} />
          <span className="ml-auto h-3 shrink-0 animate-skeleton rounded-chip bg-skeleton" style={{ width: end }} />
        </div>
      ))}
    </div>
  );
}

/** Columna de lista mientras carga una vista (título, agregado rápido y filas). */
export function WorkspaceSkeleton() {
  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto w-full max-w-[760px] px-2 pt-[30px] md:px-7">
        <div className="mx-2 h-6 w-36 animate-skeleton rounded-chip bg-skeleton md:mx-0" />
        <div className="mx-2 mt-2.5 h-3 w-52 animate-skeleton rounded-chip bg-skeleton md:mx-0" />
        <div className="mx-2 mt-[18px] hidden h-[46px] rounded-row border border-line bg-surface md:mx-0 md:block" />
        <TaskListSkeleton />
      </div>
    </div>
  );
}
