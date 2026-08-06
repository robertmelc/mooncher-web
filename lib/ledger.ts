import { createAdminClient } from "@/lib/supabase/admin";

// Stejný vzorec, co appka používá na spoustě míst (pos/redeem, transfer,
// activate) — poslední řádek v vpc_ledger_entries pro účet je aktuální
// zůstatek, nikdy se neukládá zvlášť. Sdílené sem kvůli vícevydavatelským
// kartám, kde se stejný dotaz dělá opakovaně přes víc účtů najednou.
export async function getAccountBalance(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string
): Promise<number> {
  const { data } = await admin
    .from("vpc_ledger_entries")
    .select("balance_after")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1);

  return data?.[0] ? Number(data[0].balance_after) : 0;
}

export async function getAccountBalances(
  admin: ReturnType<typeof createAdminClient>,
  accountIds: string[]
): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();

  const { data } = await admin
    .from("vpc_ledger_entries")
    .select("account_id, balance_after, created_at")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false });

  const balances = new Map<string, number>();
  for (const entry of data ?? []) {
    if (!balances.has(entry.account_id)) {
      balances.set(entry.account_id, Number(entry.balance_after));
    }
  }
  for (const id of accountIds) {
    if (!balances.has(id)) balances.set(id, 0);
  }
  return balances;
}
