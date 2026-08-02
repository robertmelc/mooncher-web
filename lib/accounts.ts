import { createAdminClient } from "@/lib/supabase/admin";

export type AccountProgram = { id: string; currency: string; balance_mode: string };

// Najde nebo založí účet pro (end_user, voucher_program) — respektuje
// balance_mode programu (pooled sdílí účet napříč vouchery stejného
// programu a člověka, isolated vždy zakládá nový — viz konverzace k migraci
// Guardian a k is_admin_issued izolaci). forceIsolated umožňuje vynutit
// izolaci nezávisle na balance_mode programu (např. admin-vydané vouchery).
// Sdílené mezi app/api/activate/[token]/route.ts a app/api/referral/[code]/route.ts
// — dřív žilo jen v aktivační route, teď potřeba na druhém místě taky.
export async function resolveOrCreateAccount(
  admin: ReturnType<typeof createAdminClient>,
  params: { endUserId: string; program: AccountProgram; forceIsolated?: boolean }
): Promise<{ accountId: string } | { error: string }> {
  const { endUserId, program, forceIsolated } = params;

  if (program.balance_mode === "isolated" || forceIsolated) {
    const { data: newAccount, error: accountInsertError } = await admin
      .from("vpc_accounts")
      .insert({
        end_user_id: endUserId,
        voucher_program_id: program.id,
        currency: program.currency,
        balance_mode: "isolated",
      })
      .select("id")
      .single();

    if (accountInsertError || !newAccount) {
      return { error: accountInsertError?.message ?? "Nepodařilo se založit účet." };
    }
    return { accountId: newAccount.id };
  }

  const { data: existingAccount, error: accountSelectError } = await admin
    .from("vpc_accounts")
    .select("id")
    .eq("end_user_id", endUserId)
    .eq("voucher_program_id", program.id)
    .maybeSingle();

  if (accountSelectError) {
    return { error: accountSelectError.message };
  }
  if (existingAccount) {
    return { accountId: existingAccount.id };
  }

  const { data: newAccount, error: accountInsertError } = await admin
    .from("vpc_accounts")
    .insert({
      end_user_id: endUserId,
      voucher_program_id: program.id,
      currency: program.currency,
      balance_mode: "pooled",
    })
    .select("id")
    .single();

  if (accountInsertError || !newAccount) {
    return { error: accountInsertError?.message ?? "Nepodařilo se založit účet." };
  }
  return { accountId: newAccount.id };
}
