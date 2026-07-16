/** Format integer cents as a euro string, e.g. 229 -> "€2.29". */
export function euros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

/** Parse a user-typed price ("2,49" or "2.49") into integer cents, or null. */
export function parsePriceToCents(input: string): number | null {
  const normalized = input.replace(',', '.').replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}
