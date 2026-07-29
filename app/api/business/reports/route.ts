import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const WINDOW_DAYS = 30;

type LedgerEntryWithTx = {
  account_id: string;
  direction: "credit" | "debit";
  amount: number;
  created_at: string;
  transaction: { type: string; status: string } | null;
};

// Viz komentář v lib/business-auth.ts — proč tohle jede přes service roli.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: programs, error: programsError } = await admin
    .from("vpc_voucher_programs")
    .select("id, name, currency")
    .eq("client_id", operator.clientId);

  if (programsError) {
    return NextResponse.json({ ok: false, error: programsError.message }, { status: 500 });
  }

  const programIds = (programs ?? []).map((p) => p.id);
  if (programIds.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const programById = new Map((programs ?? []).map((p) => [p.id, p]));

  const { data: accounts, error: accountsError } = await admin
    .from("vpc_accounts")
    .select("id, voucher_program_id")
    .in("voucher_program_id", programIds);

  if (accountsError) {
    return NextResponse.json({ ok: false, error: accountsError.message }, { status: 500 });
  }

  const accountIds = (accounts ?? []).map((a) => a.id);
  if (accountIds.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const programIdByAccount = new Map((accounts ?? []).map((a) => [a.id, a.voucher_program_id]));

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: ledgerEntries, error: ledgerError } = await admin
    .from("vpc_ledger_entries")
    .select("account_id, direction, amount, created_at, transaction:vpc_transactions ( type, status )")
    .in("account_id", accountIds)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });

  if (ledgerError) {
    return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
  }

  const rows = ((ledgerEntries as unknown as LedgerEntryWithTx[]) ?? [])
    .filter((e) => e.transaction?.status === "completed")
    .map((e) => {
      const programId = programIdByAccount.get(e.account_id);
      const program = programId ? programById.get(programId) : undefined;
      const positive = e.direction === "credit";

      return {
        date: e.created_at,
        programName: program?.name ?? "—",
        type: e.transaction?.type ?? "adjustment",
        amount: Number(e.amount),
        currency: program?.currency ?? "CZK",
        positive,
      };
    });

  return NextResponse.json({ ok: true, rows });
}
