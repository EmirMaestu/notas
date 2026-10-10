/** Primeros `n` caracteres visibles (por punto de código, para no partir emojis). */
function firstChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('');
}

/** Primer carácter visible (por punto de código: no parte pares sustitutos como los emojis). */
export function firstChar(text: string): string {
  return firstChars(text, 1);
}

/** Iniciales del avatar (como el diseño): dos palabras → dos letras, una → una, sin nombre → la del email. */
export function initials(person: { name: string; email: string }): string {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (firstChars(words[0], 1) + firstChars(words[1], 1)).toUpperCase();
  if (words.length === 1) return firstChars(words[0], 1).toUpperCase();
  return firstChars(person.email, 1).toUpperCase();
}

/** Tono estable (1 a 6) del avatar de una persona: hash simple de su id (o email). */
export function avatarTone(key: string): number {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return (hash % 6) + 1;
}
