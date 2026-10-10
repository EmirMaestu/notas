import { addDays, dayOfWeek, isValidIsoDate } from './dates';
import type { Priority } from './priority';

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: Priority;
  tags: string[];
}

const PRIORITY_WORDS: Record<string, 1 | 3 | 5> = { baja: 1, media: 3, alta: 5 };

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3,
  jueves: 4, viernes: 5, sabado: 6, 'sábado': 6,
};

// Límites de palabra que funcionan con ñ y acentos.
const START = '(?<=^|\\s)';
const END = '(?=\\s|$)';

type DateRule = { re: RegExp; resolve: (m: RegExpMatchArray, today: string) => string | null };

const DATE_RULES: DateRule[] = [
  { re: new RegExp(`${START}pasado\\s+mañana${END}`, 'i'), resolve: (_m, t) => addDays(t, 2) },
  { re: new RegExp(`${START}hoy${END}`, 'i'), resolve: (_m, t) => t },
  { re: new RegExp(`${START}mañana${END}`, 'i'), resolve: (_m, t) => addDays(t, 1) },
  {
    re: new RegExp(`${START}(?:el\\s+)?(${Object.keys(WEEKDAYS).join('|')})${END}`, 'i'),
    resolve: (m, t) => {
      const target = WEEKDAYS[m[1].toLowerCase()];
      const diff = (target - dayOfWeek(t) + 7) % 7 || 7;
      return addDays(t, diff);
    },
  },
  {
    re: new RegExp(`${START}(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?${END}`),
    resolve: (m, t) => {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      if (m[3]) {
        const iso = `${m[3]}-${month}-${day}`;
        return isValidIsoDate(iso) ? iso : null;
      }
      const year = Number(t.slice(0, 4));
      // Próxima ocurrencia válida (p. ej. 29/2 salta hasta el siguiente bisiesto).
      for (let offset = 0; offset <= 8; offset++) {
        const iso = `${year + offset}-${month}-${day}`;
        if (isValidIsoDate(iso) && iso >= t) return iso;
      }
      return null;
    },
  },
];

export function parseQuickAdd(text: string, today: string): QuickAddResult {
  let rest = ` ${text} `;

  const tags: string[] = [];
  rest = rest.replace(/(?<=\s)#([\p{L}\p{N}_-]+)(?=([,.;:!?)])|\s)/gu, (_all, name: string, punct?: string) => {
    const tag = name.toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
    return punct ? '' : ' ';
  });

  let priority: QuickAddResult['priority'] = 0;
  let prioritySet = false;
  rest = rest.replace(/(?<=\s)!(alta|media|baja)(?=\s)/gi, (_all, word: string) => {
    if (!prioritySet) {
      priority = PRIORITY_WORDS[word.toLowerCase()];
      prioritySet = true;
    }
    return ' ';
  });

  let dueDate: string | null = null;
  for (const rule of DATE_RULES) {
    const match = rest.match(rule.re);
    if (!match) continue;
    const resolved = rule.resolve(match, today);
    if (!resolved) continue;
    dueDate = resolved;
    rest = `${rest.slice(0, match.index)} ${rest.slice(match.index! + match[0].length)}`;
    break;
  }

  const title = rest.replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();
  return { title, dueDate, priority, tags };
}
