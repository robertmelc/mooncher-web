import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DOČASNÉ ŘEŠENÍ (viz konverzace k obrazovce biz-1, B4 §1.2):
 * RLS politiky pro client_operator na vpc_client_users i dalších
 * client-scoped tabulkách (vpc_voucher_programs, vpc_accounts,
 * vpc_ledger_entries, vpc_transactions, vpc_vouchers) čtou client_id
 * z JWT app_metadata — ten claim ale nikdy nevznikl, protože nemáme
 * Auth Hook, který by ho při přihlášení nastavoval podle shody e-mailu
 * ve vpc_client_users. Bez něj by klientský dotaz přes anon klienta
 * tiše vrátil prázdná data (ne chybu), ne jen na vpc_client_users, ale
 * na všem, co client_operator scope používá.
 *
 * Proto všechny /business API route handlery řeší lookup i data
 * server-side přes service roli, s e-mailem vzatým výhradně z
 * ověřeného JWT.
 *
 * SKUTEČNÉ ŘEŠENÍ pro hardening fázi: Supabase Auth Hook (custom access
 * token hook), který při vytvoření session vloží client_id + role do
 * app_metadata podle shody e-mailu ve vpc_client_users. Tím by RLS
 * z B4 konečně fungovala tak, jak byla navržená, a tyhle Route
 * Handlery by šly zrušit ve prospěch přímých klientských dotazů.
 */

export type ClientOperatorResult =
  | { ok: true; role: string; clientId: string; operatorId: string }
  | { ok: false; status: number; error: string };

export async function resolveClientOperator(
  admin: ReturnType<typeof createAdminClient>,
  accessToken: string
): Promise<ClientOperatorResult> {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Nejste přihlášeni." };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.email) {
    return { ok: false, status: 401, error: "Neplatná session." };
  }

  const { data: clientUser, error: clientUserError } = await admin
    .from("vpc_client_users")
    .select("id, role, client_id")
    .ilike("email", userData.user.email)
    .maybeSingle();

  if (clientUserError) {
    return { ok: false, status: 500, error: clientUserError.message };
  }
  if (!clientUser) {
    return { ok: false, status: 404, error: "Tento účet není napojený na žádného klienta." };
  }

  return { ok: true, role: clientUser.role, clientId: clientUser.client_id, operatorId: clientUser.id };
}
