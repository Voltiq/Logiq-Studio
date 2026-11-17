/** Which rows of a list to draw: all of a short one, else those in view and a few around them. */
export function rowWindow(count: number, top: number, height: number, row: number, above = 300): { first: number; last: number; row: number; windowed: boolean } {
  if (count <= above) return { first: 0, last: count, row, windowed: false };
  const first = Math.max(0, Math.floor(top / row) - 12);
  const last = Math.min(count, Math.ceil((top + height) / row) + 12);
  return { first, last: Math.max(last, Math.min(count, first + 1)), row, windowed: true };
}
