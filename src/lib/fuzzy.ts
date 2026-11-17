/** Subsequence match with a score that prefers starts of words and the file name. */
export function fuzzy(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  let score = 0;
  let at = 0;
  let last = -2;
  for (const ch of q) {
    const i = s.indexOf(ch, at);
    if (i < 0) return null;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || /[\s/._-]/.test(s[i - 1]) || (text[i] >= "A" && text[i] <= "Z")) score += 2;
    last = i;
    at = i + 1;
  }
  return score - s.length * 0.01;
}
