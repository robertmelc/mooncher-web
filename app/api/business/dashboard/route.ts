import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const ACTIVE_VOUCHER_STATUSES = ["issued", "activated", "partially_used"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type LedgerEntryWithTx = {
  amount: number;
  created_at: string;
  transaction: { type: string; status: string } | null;
};

// Viz komentář v lib/business-auth.ts — proč tohle jede přes service
// roli místo přímého klientského dotazu.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: programs, error: programsError } = await admin
    .from("vpc_voucher_programs")
    .select("id, status, currency")
    .eq("client_id", operator.clientId);

  if (programsError) {
    return NextResponse.json({ ok: false, error: programsError.message }, { status: 500 });
  }

  const activeProgramCount = (programs ?? []).filter((p) => p.status === "active").length;
  const programIds = (programs ?? []).map((p) => p.id);
  // Zjednodušení: bereme měnu prvního programu. Klient s programy ve víc
  // měnách by potřeboval součet po měnách, ne jedno číslo — neřešeno teď.
  const currency = programs?.[0]?.currency ?? "CZK";

  if (programIds.length === 0) {
    return NextResponse.json({
      ok: true,
      activeProgramCount: 0,
      volume30d: 0,
      currency,
      activeVoucherCount: 0,
    });
  }

  const { data: accounts, error: accountsError } = await admin
    .from("vpc_accounts")
    .select("id")
    .in("voucher_program_id", programIds);

  if (accountsError) {
    return NextResponse.json({ ok: false, error: accountsError.message }, { status: 500 });
  }
  const accountIds = (accounts ?? []).map((a) => a.id);

  let volume30d = 0;
  if (accountIds.length > 0) {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const { data: ledgerEntries, error: ledgerError } = await admin
      .from("vpc_ledger_entries")
      .select("amount, created_at, transaction:vpc_transactions ( type, status )")
      .in("account_id", accountIds)
      .eq("direction", "credit")
      .gte("created_at", cutoff);

    if (ledgerError) {
      return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
    }

    volume30d = ((ledgerEntries as unknown as LedgerEntryWithTx[]) ?? [])
      .filter((e) => e.transaction?.type === "load" && e.transaction?.status === "completed")
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }

  const { count: activeVoucherCount, error: vouchersError } = await admin
    .from("vpc_vouchers")
    .select("id", { count: "exact", head: true })
    .in("voucher_program_id", programIds)
    .in("status", ACTIVE_VOUCHER_STATUSES);

  if (vouchersError) {
    return NextResponse.json({ ok: false, error: vouchersError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    activeProgramCount,
    volume30d,
    currency,
    activeVoucherCount: activeVoucherCount ?? 0,
  });
}
