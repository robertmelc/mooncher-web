import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

const TRANSACTIONS_WINDOW_DAYS = 30;
const AUDIT_LOG_LIMIT = 50;

type LedgerEntryWithTx = {
  account_id: string;
  direction: "credit" | "debit";
  amount: number;
  created_at: string;
  transaction: { type: string; status: string } | null;
};

type AuditLogRow = {
  id: number;
  actor_type: string;
  action: string;
  target_table: string;
  created_at: string;
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const clientId = params.id;

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: client, error: clientError } = await admin
    .from("vpc_clients")
    .select("id, name, status, stripe_connect_status, contact_email")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Klient nenalezen." }, { status: 404 });
  }

  // Audit log i na zobrazení — detail klienta ukazuje transakční historii
  // a jeho vlastní audit stopu, citlivější než pouhý seznam (adm-2 zobrazení
  // neloguje, jen mutace suspend/reactivate).
  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.client_detail_viewed",
    target_table: "vpc_clients",
    target_id: clientId,
  });

  const { data: programs, error: programsError } = await admin
    .from("vpc_voucher_programs")
    .select("id, name, status, voucher_type, currency")
    .eq("client_id", clientId)
    .order("name");

  if (programsError) {
    return NextResponse.json({ ok: false, error: programsError.message }, { status: 500 });
  }

  const programIds = (programs ?? []).map((p) => p.id);
  const programById = new Map((programs ?? []).map((p) => [p.id, p]));

  let transactions: {
    date: string;
    programName: string;
    type: string;
    amount: number;
    currency: string;
    positive: boolean;
  }[] = [];

  let voucherIds: string[] = [];

  if (programIds.length > 0) {
    const { data: vouchers, error: vouchersError } = await admin
      .from("vpc_vouchers")
      .select("id")
      .in("voucher_program_id", programIds);

    if (vouchersError) {
      return NextResponse.json({ ok: false, error: vouchersError.message }, { status: 500 });
    }
    voucherIds = (vouchers ?? []).map((v) => v.id);

    const { data: accounts, error: accountsError } = await admin
      .from("vpc_accounts")
      .select("id, voucher_program_id")
      .in("voucher_program_id", programIds);

    if (accountsError) {
      return NextResponse.json({ ok: false, error: accountsError.message }, { status: 500 });
    }

    const accountIds = (accounts ?? []).map((a) => a.id);
    const programIdByAccount = new Map((accounts ?? []).map((a) => [a.id, a.voucher_program_id]));

    if (accountIds.length > 0) {
      const cutoff = new Date(Date.now() - TRANSACTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data: ledgerEntries, error: ledgerError } = await admin
        .from("vpc_ledger_entries")
        .select("account_id, direction, amount, created_at, transaction:vpc_transactions ( type, status )")
        .in("account_id", accountIds)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false });

      if (ledgerError) {
        return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
      }

      transactions = ((ledgerEntries as unknown as LedgerEntryWithTx[]) ?? [])
        .filter((e) => e.transaction?.status === "completed")
        .map((e) => {
          const programId = programIdByAccount.get(e.account_id);
          const program = programId ? programById.get(programId) : undefined;
          return {
            date: e.created_at,
            programName: program?.name ?? "—",
            type: e.transaction?.type ?? "adjustment",
            amount: Number(e.amount),
            currency: program?.currency ?? "CZK",
            positive: e.direction === "credit",
          };
        });
    }
  }

  // vpc_audit_log nemá client_id sloupec (stejný gap jako HARDENING.md #3) —
  // "audit log tohoto klienta" je sjednocení přímých zásahů do klienta
  // (target_table=vpc_clients) a pokusů na jeho voucherech
  // (target_table=vpc_vouchers, target_id = id jednoho z jeho voucherů).
  const clientLogQuery = admin
    .from("vpc_audit_log")
    .select("id, actor_type, action, target_table, created_at")
    .eq("target_table", "vpc_clients")
    .eq("target_id", clientId);

  const voucherLogQuery =
    voucherIds.length > 0
      ? admin
          .from("vpc_audit_log")
          .select("id, actor_type, action, target_table, created_at")
          .eq("target_table", "vpc_vouchers")
          .in("target_id", voucherIds)
      : null;

  const [clientLogResult, voucherLogResult] = await Promise.all([
    clientLogQuery,
    voucherLogQuery ?? Promise.resolve({ data: [] as AuditLogRow[], error: null }),
  ]);

  if (clientLogResult.error) {
    return NextResponse.json({ ok: false, error: clientLogResult.error.message }, { status: 500 });
  }
  if (voucherLogResult.error) {
    return NextResponse.json({ ok: false, error: voucherLogResult.error.message }, { status: 500 });
  }

  const auditLog = [...(clientLogResult.data ?? []), ...(voucherLogResult.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, AUDIT_LOG_LIMIT)
    .map((row) => ({
      actorType: row.actor_type,
      action: row.action,
      targetTable: row.target_table,
      createdAt: row.created_at,
    }));

  return NextResponse.json({
    ok: true,
    client,
    programs: programs ?? [],
    transactions,
    auditLog,
  });
}
