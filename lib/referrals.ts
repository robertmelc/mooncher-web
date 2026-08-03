import { createAdminClient } from "@/lib/supabase/admin";

export type ReferralLevel = { id: string; name: string; threshold: number };

export type DefaultReferralProgram = {
  id: string;
  currency: string;
  balance_mode: string;
  default_validity_days: number | null;
};

// Program, na kterém vzniká voucher KAŽDÉMU, kdo se přes referral propojí —
// bez ohledu na to, z jakého konkrétního vouchru pozvatele QR/odkaz
// pochází (Ambassador/Helper jsou úrovně ZÍSKANÉ pozváním, ne něco, co by
// se od zdrojového vouchru dědilo). Viz konverzace k opravě 3. 8. 2026.
export async function resolveDefaultProgram(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string
): Promise<DefaultReferralProgram | null> {
  const { data: settings } = await admin
    .from("vpc_referral_settings")
    .select("default_voucher_program_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!settings?.default_voucher_program_id) return null;

  const { data: program } = await admin
    .from("vpc_voucher_programs")
    .select("id, currency, balance_mode, default_validity_days")
    .eq("id", settings.default_voucher_program_id)
    .maybeSingle();

  return program ?? null;
}

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
