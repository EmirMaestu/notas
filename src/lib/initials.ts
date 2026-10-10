/** Primeros `n` caracteres visibles (por punto de código, para no partir emojis). */
function firstChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('');
}

/** Iniciales para el avatar: de las dos primeras palabras del nombre o, sin nombre, del email. */
export function initials(person: { name: string; email: string }): string {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (firstChars(words[0], 1) + firstChars(words[1], 1)).toUpperCase();
  if (words.length === 1) return firstChars(words[0], 2).toUpperCase();
  return firstChars(person.email, 2).toUpperCase();
}
