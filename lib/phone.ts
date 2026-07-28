export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function isValidPhone(raw: string): boolean {
  const normalized = normalizePhone(raw);
  const digitsOnly = normalized.replace("+", "");
  return digitsOnly.length >= 9;
}
