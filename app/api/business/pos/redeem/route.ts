import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const REDEEMABLE_STATUSES = ["activated", "partially_used"];

type VoucherRow = {
  id: string;
  status: string;
  account_id: string;
  voucher_program: { client_id: string; client: { name: string } | null } | null;
};

async function logAttempt(
  admin: ReturnType<typeof createAdminClient>,
  voucherId: string,
  action: string,
  afterState?: Record<string, unknown>
) {
  await admin.from("vpc_audit_log").insert({
    actor_type: "client_operator",
    action,
    target_table: "vpc_vouchers",
    target_id: voucherId,
    after_state: afterState ?? null,
  });
}

/**
 * Nejrizikovější zápis v appce — ubírá hodnotu z účtu koncového uživatele
 * na základě fyzické akce na prodejně, ne jeho vlastního rozhodnutí v
 * appce (viz konverzace k obrazovce biz-8). Bezpečnostní vrstvy:
 * 1. resolveClientOperator — jen ověřený client_operator
 * 2. vlastnictví — voucher musí patřit pod program TOHOTO klienta,
 *    ověřeno znovu tady (ne jen v /lookup), generická 404 při neshodě
 * 3. idempotency_key — chrání proti duplicitnímu odeslání/retry
 * 4. optimistic-concurrency recheck těsně před zápisem — přísnější než
 *    u transferu (screen 07), protože jde o cizí peníze, ne vlastní.
 *    Pořád ne plná DB transakce/row lock — to čeká na Postgres RPC
 *    v hardening fázi, stejná poznámka jako u transferu.
 * 5. audit log na každý pokus, úspěšný i zamítnutý
 *
 * VĚDOMĚ NEIMPLEMENTOVÁNO TEĎ: B5 §7 dokumentuje rate limit 30 req/min/
 * klíč pro tenhle endpoint. vpc_audit_log nemá sloupec pro efektivní
 * "kolik pokusů za minutu udělal tenhle klient" dotaz bez schema
 * rozšíření — odloženo do hardening fáze, ne tiše vynecháno.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  let body: { voucherId?: string; amount?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { voucherId, amount, idempotencyKey } = body;
  if (!voucherId || !idempotencyKey || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Neplatné parametry." }, { status: 400 });
  }

  const { data: existingTx } = await admin
    .from("vpc_transactions")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingTx) {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const { data: voucherRow, error: voucherError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, status, account_id,
       voucher_program:vpc_voucher_programs ( client_id, client:vpc_clients ( name ) )`
    )
    .eq("id", voucherId)
    .maybeSingle();

  if (voucherError) {
    return NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 });
  }

  const voucher = voucherRow as unknown as VoucherRow | null;

  if (!voucher || !voucher.voucher_program || voucher.voucher_program.client_id !== operator.clientId) {
    await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "not_found_or_wrong_client" });
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  if (!REDEEMABLE_STATUSES.includes(voucher.status)) {
    await logAttempt(admin, voucherId, "voucher.redemption_rejected", {
      reason: "invalid_status",
      status: voucher.status,
    });
    return NextResponse.json({ ok: false, error: "Tento voucher nelze teď uplatnit." }, { status: 409 });
  }

  const { data: latestEntries, error: latestError } = await admin
    .from("vpc_ledger_entries")
    .select("id, balance_after")
    .eq("account_id", voucher.account_id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (latestError) {
    return NextResponse.json({ ok: false, error: latestError.message }, { status: 500 });
  }

  const lastEntryId = latestEntries?.[0]?.id ?? null;
  const balance = latestEntries?.[0] ? Number(latestEntries[0].balance_after) : 0;

  if (amount > balance) {
    await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "insufficient_balance" });
    return NextResponse.json({ ok: false, error: "Nedostatečný zůstatek." }, { status: 400 });
  }

  // Optimistic-concurrency recheck — viz komentář výše.
  const { data: recheckEntries, error: recheckError } = await admin
    .from("vpc_ledger_entries")
    .select("id")
    .eq("account_id", voucher.account_id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (recheckError) {
    return NextResponse.json({ ok: false, error: recheckError.message }, { status: 500 });
  }
  if ((recheckEntries?.[0]?.id ?? null) !== lastEntryId) {
    await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "concurrent_change" });
    return NextResponse.json(
      { ok: false, error: "Zůstatek se mezitím změnil, zkuste to znovu." },
      { status: 409 }
    );
  }

  const newBalance = balance - amount;

  const { data: transaction, error: txError } = await admin
    .from("vpc_transactions")
    .insert({
      type: "redeem",
      idempotency_key: idempotencyKey,
      gross_amount: 0,
      platform_fee_amount: 0,
      initiated_by: "client_operator",
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { voucher_id: voucherId },
    })
    .select("id")
    .single();

  if (txError || !transaction) {
    return NextResponse.json({ ok: false, error: txError?.message ?? "Zápis transakce selhal." }, { status: 500 });
  }

  const { error: ledgerError } = await admin.from("vpc_ledger_entries").insert({
    account_id: voucher.account_id,
    transaction_id: transaction.id,
    direction: "debit",
    amount,
    balance_after: newBalance,
  });

  if (ledgerError) {
    return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
  }

  const { error: redemptionError } = await admin.from("vpc_redemptions").insert({
    voucher_id: voucherId,
    transaction_id: transaction.id,
    merchant_ref: voucher.voucher_program.client?.name ?? null,
    amount,
    redeemed_by_operator: operator.operatorId,
  });

  if (redemptionError) {
    return NextResponse.json({ ok: false, error: redemptionError.message }, { status: 500 });
  }

  const newStatus = newBalance === 0 ? "used" : "partially_used";
  const { error: statusError } = await admin
    .from("vpc_vouchers")
    .update({ status: newStatus })
    .eq("id", voucherId);

  if (statusError) {
    return NextResponse.json({ ok: false, error: statusError.message }, { status: 500 });
  }

  await logAttempt(admin, voucherId, "voucher.redeemed", { amount, newBalance, newStatus });

  return NextResponse.json({ ok: true, newBalance, newStatus });
}
