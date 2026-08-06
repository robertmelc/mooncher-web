import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";
import { getAccountBalances } from "@/lib/ledger";

const REDEEMABLE_STATUSES = ["activated", "partially_used"];

type VoucherRow = {
  id: string;
  status: string;
  account_id: string | null;
  multi_issuer_program_id: string | null;
  voucher_program: { client_id: string; client: { name: string } | null } | null;
};

type IssuerAccountRow = {
  account_id: string;
  client_id: string;
  client: { name: string } | null;
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

// Doplácecí pořadí je PEVNÁ vlastnost skupiny (settlement_priority),
// nikdy se nepočítá z aktuálního zůstatku — viz konverzace. Vrací plán
// jen do pokrytí nedostatku, ne víc.
async function buildDrawPlan(
  admin: ReturnType<typeof createAdminClient>,
  multiIssuerProgramId: string,
  ownClientId: string,
  shortfall: number,
  issuerAccounts: IssuerAccountRow[]
): Promise<{ drawPlan: { clientId: string; clientName: string; accountId: string; amount: number }[]; covered: boolean }> {
  const { data: program } = await admin
    .from("vpc_multi_issuer_programs")
    .select("client_group_id")
    .eq("id", multiIssuerProgramId)
    .maybeSingle();

  if (!program) return { drawPlan: [], covered: false };

  const { data: members } = await admin
    .from("vpc_client_group_members")
    .select("client_id, settlement_priority")
    .eq("group_id", program.client_group_id)
    .neq("client_id", ownClientId)
    .order("settlement_priority", { ascending: true });

  const accountByClient = new Map(issuerAccounts.map((a) => [a.client_id, a]));
  const otherAccountIds = (members ?? [])
    .map((m) => accountByClient.get(m.client_id)?.account_id)
    .filter((id): id is string => !!id);
  const balances = await getAccountBalances(admin, otherAccountIds);

  const drawPlan: { clientId: string; clientName: string; accountId: string; amount: number }[] = [];
  let remaining = shortfall;

  for (const member of members ?? []) {
    if (remaining <= 0) break;
    const account = accountByClient.get(member.client_id);
    if (!account) continue;
    const available = balances.get(account.account_id) ?? 0;
    if (available <= 0) continue;
    const draw = Math.min(available, remaining);
    drawPlan.push({ clientId: member.client_id, clientName: account.client?.name ?? "", accountId: account.account_id, amount: draw });
    remaining -= draw;
  }

  return { drawPlan, covered: remaining <= 0 };
}

/**
 * Nejrizikovější zápis v appce — viz komentář k jednovydavatelské cestě
 * níže, platí beze změny. Vícevydavatelská větev navíc:
 * - doplácení z jiné firmy skupiny NENÍ automatické — appka ho jen
 *   NABÍDNE (needsGroupSettlement), operátor ho musí výslovně potvrdit
 *   (confirmGroupSettlement) v samostatném požadavku.
 * - vpc_inter_issuer_settlements řádek vzniká VÝHRADNĚ po úspěchu všech
 *   odečtů — při selhání uprostřed appka nezapíše žádný dluh za něco,
 *   co se nestalo, a nechá zápis dohledatelný jako roztržený (ledger
 *   odečty bez odpovídajícího vpc_redemptions řádku). Viz HARDENING #13
 *   — NOVÁ položka, ne rozšíření #2 (jiný, závažnější druh selhání).
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  let body: { voucherId?: string; amount?: number; idempotencyKey?: string; confirmGroupSettlement?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { voucherId, amount, idempotencyKey, confirmGroupSettlement } = body;
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
      `id, status, account_id, multi_issuer_program_id,
       voucher_program:vpc_voucher_programs ( client_id, client:vpc_clients ( name ) )`
    )
    .eq("id", voucherId)
    .maybeSingle();

  if (voucherError) {
    return NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 });
  }

  const voucher = voucherRow as unknown as VoucherRow | null;

  // ---------- Vícevydavatelská karta ----------
  if (voucher?.multi_issuer_program_id) {
    if (!REDEEMABLE_STATUSES.includes(voucher.status)) {
      await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "invalid_status", status: voucher.status });
      return NextResponse.json({ ok: false, error: "Tento voucher nelze teď uplatnit." }, { status: 409 });
    }

    const { data: issuerAccountsData, error: issuerAccountsError } = await admin
      .from("vpc_voucher_issuer_accounts")
      .select("account_id, client_id, client:vpc_clients ( name )")
      .eq("voucher_id", voucherId);

    if (issuerAccountsError) {
      return NextResponse.json({ ok: false, error: issuerAccountsError.message }, { status: 500 });
    }

    const issuerAccounts = (issuerAccountsData ?? []) as unknown as IssuerAccountRow[];
    const ownAccount = issuerAccounts.find((a) => a.client_id === operator.clientId);

    if (!ownAccount) {
      await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "not_found_or_wrong_client" });
      return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
    }

    const { data: ownEntries } = await admin
      .from("vpc_ledger_entries")
      .select("id, balance_after")
      .eq("account_id", ownAccount.account_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const ownLastEntryId = ownEntries?.[0]?.id ?? null;
    const ownBalance = ownEntries?.[0] ? Number(ownEntries[0].balance_after) : 0;

    // --- Vlastní zůstatek stačí — přesně stejná cesta jako jednovydavatelský voucher ---
    if (amount <= ownBalance) {
      const { data: recheck } = await admin
        .from("vpc_ledger_entries")
        .select("id")
        .eq("account_id", ownAccount.account_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if ((recheck?.[0]?.id ?? null) !== ownLastEntryId) {
        await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "concurrent_change" });
        return NextResponse.json({ ok: false, error: "Zůstatek se mezitím změnil, zkuste to znovu." }, { status: 409 });
      }

      const newOwnBalance = ownBalance - amount;

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
          metadata: { voucher_id: voucherId, multi_issuer: true },
        })
        .select("id")
        .single();

      if (txError || !transaction) {
        // Stejný souběh jako u skupinového doplatku níž — dvojklik na
        // "Potvrdit uplatnění" chytí UNIQUE na idempotency_key.
        if (txError?.code === "23505") {
          return NextResponse.json({ ok: true, alreadyProcessed: true });
        }
        return NextResponse.json({ ok: false, error: txError?.message ?? "Zápis transakce selhal." }, { status: 500 });
      }

      const { error: ledgerError } = await admin.from("vpc_ledger_entries").insert({
        account_id: ownAccount.account_id,
        transaction_id: transaction.id,
        direction: "debit",
        amount,
        balance_after: newOwnBalance,
      });
      if (ledgerError) {
        return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
      }

      const { error: redemptionError } = await admin.from("vpc_redemptions").insert({
        voucher_id: voucherId,
        transaction_id: transaction.id,
        merchant_ref: ownAccount.client?.name ?? null,
        amount,
        redeemed_by_operator: operator.operatorId,
      });
      if (redemptionError) {
        return NextResponse.json({ ok: false, error: redemptionError.message }, { status: 500 });
      }

      const otherIds = issuerAccounts.filter((a) => a.account_id !== ownAccount.account_id).map((a) => a.account_id);
      const otherBalances = await getAccountBalances(admin, otherIds);
      const totalBalance = newOwnBalance + Array.from(otherBalances.values()).reduce((a, b) => a + b, 0);

      const newStatus = totalBalance === 0 ? "used" : "partially_used";
      await admin.from("vpc_vouchers").update({ status: newStatus }).eq("id", voucherId);

      await logAttempt(admin, voucherId, "voucher.redeemed", { amount, newOwnBalance, newStatus, totalBalance });

      return NextResponse.json({ ok: true, newBalance: newOwnBalance, newStatus, totalBalance });
    }

    // --- Vlastní zůstatek nestačí — potřeba doplatek ze skupiny ---
    const shortfall = amount - ownBalance;
    const { drawPlan, covered } = await buildDrawPlan(
      admin,
      voucher.multi_issuer_program_id,
      operator.clientId,
      shortfall,
      issuerAccounts
    );

    if (!covered) {
      await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "insufficient_group_balance" });
      return NextResponse.json({ ok: false, error: "Na kartě není dost prostředků ani napříč skupinou." }, { status: 400 });
    }

    if (!confirmGroupSettlement) {
      // Jen NABÍDKA — appka nic nezapisuje, dokud operátor výslovně
      // nepotvrdí. Viz konverzace: doplácení nesmí být automatické.
      return NextResponse.json(
        {
          ok: false,
          needsGroupSettlement: true,
          ownBalance,
          shortfall,
          totalAvailable: ownBalance + drawPlan.reduce((a, d) => a + d.amount, 0),
          drawPlan: drawPlan.map((d) => ({ clientId: d.clientId, clientName: d.clientName, amount: d.amount })),
        },
        { status: 409 }
      );
    }

    // --- Potvrzeno operátorem — recheck čerstvosti všech zapojených účtů těsně před zápisem ---
    const involvedAccountIds = [ownAccount.account_id, ...drawPlan.map((d) => d.accountId)];
    const { data: recheckRows } = await admin
      .from("vpc_ledger_entries")
      .select("account_id, id, created_at")
      .in("account_id", involvedAccountIds)
      .order("created_at", { ascending: false });

    const recheckLatestByAccount = new Map<string, string>();
    for (const row of recheckRows ?? []) {
      if (!recheckLatestByAccount.has(row.account_id)) recheckLatestByAccount.set(row.account_id, row.id);
    }
    if ((recheckLatestByAccount.get(ownAccount.account_id) ?? null) !== ownLastEntryId) {
      await logAttempt(admin, voucherId, "voucher.redemption_rejected", { reason: "concurrent_change" });
      return NextResponse.json({ ok: false, error: "Zůstatek se mezitím změnil, zkuste to znovu." }, { status: 409 });
    }

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
        metadata: { voucher_id: voucherId, multi_issuer: true, group_settlement: true },
      })
      .select("id")
      .single();

    if (txError || !transaction) {
      // Souběh dvou požadavků se stejným idempotencyKey (typicky dvojklik
      // "Doplatit ze skupiny") — UNIQUE na idempotency_key zaručuje, že
      // projde jen jeden insert. Ten druhý tohle chytí jako honest "už
      // hotovo", ne jako cizí chybu; žádný odečet mezitím nevznikl, protože
      // insert transakce běží PŘED odečty v hlavní knize.
      if (txError?.code === "23505") {
        return NextResponse.json({ ok: true, alreadyProcessed: true });
      }
      return NextResponse.json({ ok: false, error: txError?.message ?? "Zápis transakce selhal." }, { status: 500 });
    }

    // Odečty — vlastní účet + každý doplácející účet. Pokud kterýkoliv
    // zápis selže, appka se NEPOKOUŠÍ vracet už zapsané odečty (žádná
    // skutečná DB transakce napříč voláními, HARDENING #2/#13) — místo
    // toho vrátí čestnou chybu a NEZAPÍŠE vpc_redemptions ani
    // vpc_inter_issuer_settlements, ať zůstane roztržený stav dohledatelný
    // (ledger odečty bez odpovídajícího redemptions řádku), ne tichý.
    // Vlastní účet se odečítá jen o svůj podíl (ownBalance) — zbytek (shortfall)
    // pokrývá drawPlan. Součet ownBalance + shortfall == amount vždy platí,
    // protože jsme v téhle větvi právě proto, že amount > ownBalance. Když je
    // ownBalance 0 (vlastní účet je už vyčerpaný), vlastní odečet se vůbec
    // nezapisuje — nulový zápis by narazil na vpc_ledger_entries_amount_check
    // (žádný pohyb v hlavní knize nemá dávat smysl s částkou 0).
    const debits = [
      ...(ownBalance > 0 ? [{ accountId: ownAccount.account_id, amount: ownBalance, balanceBefore: ownBalance }] : []),
      ...drawPlan.map((d) => ({ accountId: d.accountId, amount: d.amount, balanceBefore: null as number | null })),
    ];

    const otherBalancesForDebit = await getAccountBalances(admin, drawPlan.map((d) => d.accountId));

    let writeFailed = false;
    for (const debit of debits) {
      const before = debit.balanceBefore ?? otherBalancesForDebit.get(debit.accountId) ?? 0;
      const { error } = await admin.from("vpc_ledger_entries").insert({
        account_id: debit.accountId,
        transaction_id: transaction.id,
        direction: "debit",
        amount: debit.amount,
        balance_after: before - debit.amount,
      });
      if (error) {
        writeFailed = true;
        break;
      }
    }

    if (writeFailed) {
      await logAttempt(admin, voucherId, "voucher.redemption_torn", {
        reason: "ledger_write_failed_mid_sequence",
        transactionId: transaction.id,
      });
      return NextResponse.json(
        { ok: false, error: "Uplatnění se nedokončilo, kontaktujte podporu." },
        { status: 500 }
      );
    }

    const { error: redemptionError } = await admin.from("vpc_redemptions").insert({
      voucher_id: voucherId,
      transaction_id: transaction.id,
      merchant_ref: ownAccount.client?.name ?? null,
      amount,
      redeemed_by_operator: operator.operatorId,
    });

    if (redemptionError) {
      await logAttempt(admin, voucherId, "voucher.redemption_torn", {
        reason: "redemptions_write_failed",
        transactionId: transaction.id,
      });
      return NextResponse.json(
        { ok: false, error: "Uplatnění se nedokončilo, kontaktujte podporu." },
        { status: 500 }
      );
    }

    const settlementRows = drawPlan.map((d) => ({
      voucher_id: voucherId,
      transaction_id: transaction.id,
      creditor_client_id: d.clientId,
      debtor_client_id: operator.clientId,
      amount: d.amount,
    }));

    const { error: settlementError } = await admin.from("vpc_inter_issuer_settlements").insert(settlementRows);
    if (settlementError) {
      await logAttempt(admin, voucherId, "voucher.redemption_torn", {
        reason: "settlement_write_failed",
        transactionId: transaction.id,
      });
      return NextResponse.json(
        { ok: false, error: "Uplatnění se nedokončilo, kontaktujte podporu." },
        { status: 500 }
      );
    }

    const allBalances = await getAccountBalances(admin, issuerAccounts.map((a) => a.account_id));
    const totalBalance = Array.from(allBalances.values()).reduce((a, b) => a + b, 0);
    const newStatus = totalBalance === 0 ? "used" : "partially_used";
    await admin.from("vpc_vouchers").update({ status: newStatus }).eq("id", voucherId);

    await logAttempt(admin, voucherId, "voucher.redeemed", {
      amount,
      ownAmount: ownBalance,
      drawPlan,
      newStatus,
      totalBalance,
    });

    return NextResponse.json({
      ok: true,
      newBalance: 0,
      newStatus,
      totalBalance,
      settlements: drawPlan.map((d) => ({ clientName: d.clientName, amount: d.amount })),
    });
  }

  // ---------- Jednovydavatelský voucher (beze změny) ----------
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
