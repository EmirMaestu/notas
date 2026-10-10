import { dayOfWeek } from '@/core/dates';

const SHORT_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const LONG_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "Hoy", "Mañana", "Ayer", día corto si cae en los próximos 6 días, o dd/mm[/aaaa]. */
export function formatDueLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 1 && diff < 7) return SHORT_DAYS[dayOfWeek(dueDate)];
  if (dueDate.slice(0, 4) !== today.slice(0, 4)) return `${dayMonth(dueDate)}/${dueDate.slice(0, 4)}`;
  return dayMonth(dueDate);
}

export interface TaskGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

/** Agrupa (manteniendo el orden recibido) en Vencidas, un grupo por día y Sin fecha. */
export function groupTasksByDate<T extends { dueDate: string | null }>(tasks: T[], today: string): TaskGroup<T>[] {
  const overdue: T[] = [];
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];
  for (const task of tasks) {
    if (task.dueDate === null) undated.push(task);
    else if (task.dueDate < today) overdue.push(task);
    else {
      const day = byDay.get(task.dueDate);
      if (day) day.push(task);
      else byDay.set(task.dueDate, [task]);
    }
  }
  const groups: TaskGroup<T>[] = [];
  if (overdue.length) groups.push({ key: 'overdue', label: 'Vencidas', tasks: overdue });
  for (const day of [...byDay.keys()].sort()) {
    const diff = daysBetween(today, day);
    const year = day.slice(0, 4) !== today.slice(0, 4) ? `/${day.slice(0, 4)}` : '';
    const label = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : `${LONG_DAYS[dayOfWeek(day)]} ${dayMonth(day)}${year}`;
    groups.push({ key: day, label, tasks: byDay.get(day)! });
  }
  if (undated.length) groups.push({ key: 'undated', label: 'Sin fecha', tasks: undated });
  return groups;
}
