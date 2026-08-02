export type ReferralLevel = { id: string; name: string; threshold: number };

// Úroveň se nikde neukládá — vždy dopočítaná z počtu přímých pozvání proti
// aktuální konfiguraci klienta (viz konverzace k referral systému). Díky
// tomu je vždy aktuální i po změně prahů, bez nutnosti cokoli přepočítávat.
export function resolveCurrentLevel(directCount: number, levels: ReferralLevel[]): ReferralLevel | null {
  const sorted = [...levels].sort((a, b) => a.threshold - b.threshold);
  let current: ReferralLevel | null = null;
  for (const level of sorted) {
    if (directCount >= level.threshold) current = level;
  }
  return current;
}

export function resolveNextLevel(directCount: number, levels: ReferralLevel[]): ReferralLevel | null {
  const sorted = [...levels].sort((a, b) => a.threshold - b.threshold);
  return sorted.find((level) => level.threshold > directCount) ?? null;
}
