import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { resolveOrCreateAccount } from "@/lib/accounts";
import { splitAmount, splitPercentSumsTo100, type SplitMember } from "@/lib/multiIssuer";
import { generateMultiIssuerVoucherCode, generateNewVoucherId, placeholderQrSignature } from "@/lib/voucherIssuance";
import { normalizePhone } from "@/lib/phone";

type MemberRow = {
  split_percent: number;
  voucher_program: {
    id: string;
    currency: string;
    balance_mode: string;
    client_id: string;
  } | null;
};

// Vydá vícevydavatelskou kartu — jediné místo v appce, co zakládá
// chr_/vpc_voucher_issuer_accounts řádky a rozděluje částku napříč firmami
// PŘI VYDÁNÍ (ne dodatečně při čerpání), viz konverzace. Karta vzniká rovnou
// jako "activated" — příjemce je identifikovaný telefonem synchronně v
// tomhle requestu (stejný důvod jako u referral-vzniklých voucherů), appka
// tu neřeší odloženou aktivaci přes magic-link.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  let body: {
    multiIssuerProgramId?: string;
    targetPhone?: string;
    totalAmount?: number;
    overrides?: { voucherProgramId: string; amount: number }[];
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { multiIssuerProgramId, targetPhone, totalAmount, overrides, idempotencyKey } = body;

  if (!multiIssuerProgramId) {
    return NextResponse.json({ ok: false, error: "Vyberte vícevydavatelský program." }, { status: 400 });
  }
  if (!targetPhone || !targetPhone.trim()) {
    return NextResponse.json({ ok: false, error: "Zadejte telefon výherce/držitele." }, { status: 400 });
  }
  if (typeof totalAmount !== "number" || totalAmount <= 0) {
    return NextResponse.json({ ok: false, error: "Zadejte kladnou celkovou částku." }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json({ ok: false, error: "Chybí idempotencyKey." }, { status: 400 });
  }

  const { data: existingTx } = await admin
    .from("vpc_transactions")
    .select("id, metadata")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingTx) {
    const voucherId = (existingTx.metadata as { multi_issuer_voucher_id?: string } | null)?.multi_issuer_voucher_id;
    return NextResponse.json({ ok: true, alreadyProcessed: true, voucherId: voucherId ?? null });
  }

  const { data: program, error: programError } = await admin
    .from("vpc_multi_issuer_programs")
    .select(
      `id, name, currency,
       members:vpc_multi_issuer_program_members (
         split_percent,
         voucher_program:vpc_voucher_programs ( id, currency, balance_mode, client_id )
       )`
    )
    .eq("id", multiIssuerProgramId)
    .maybeSingle();

  if (programError) {
    return NextResponse.json({ ok: false, error: programError.message }, { status: 500 });
  }
  if (!program) {
    return NextResponse.json({ ok: false, error: "Program nenalezen." }, { status: 404 });
  }

  const members = (program.members as unknown as MemberRow[]).filter((m) => m.voucher_program);
  // "Vícevydavatelský" o definici znamená aspoň dva — uzavírá to díru, co
  // vznikla uvolněním account_id na nullable (dřív to hlídal NOT NULL,
  // teď to musí hlídat appka, viz HARDENING.md).
  if (members.length < 2) {
    return NextResponse.json({ ok: false, error: "Vícevydavatelský program musí mít aspoň dva členy." }, { status: 400 });
  }
  if (!splitPercentSumsTo100(members.map((m) => ({ splitPercent: m.split_percent })))) {
    return NextResponse.json(
      { ok: false, error: "Rozdělovací poměr členů programu nedává dohromady 100 %." },
      { status: 400 }
    );
  }

  // Rozdělení: buď z formuláře zadané přesné částky za člena (musí sedět
  // na celkovou částku do koruny), nebo výchozí procenta programu.
  let splits: { voucherProgramId: string; amount: number }[];
  if (overrides && overrides.length > 0) {
    const overrideByProgram = new Map(overrides.map((o) => [o.voucherProgramId, o.amount]));
    const memberProgramIds = new Set(members.map((m) => m.voucher_program!.id));
    const overrideKeys = Array.from(overrideByProgram.keys());
    if (overrideByProgram.size !== memberProgramIds.size || overrideKeys.some((id) => !memberProgramIds.has(id))) {
      return NextResponse.json({ ok: false, error: "Rozdělení neodpovídá členům programu." }, { status: 400 });
    }
    const overrideSum = Array.from(overrideByProgram.values()).reduce((a, b) => a + b, 0);
    if (Math.round(overrideSum) !== Math.round(totalAmount)) {
      return NextResponse.json({ ok: false, error: "Součet rozdělení nesedí na celkovou částku." }, { status: 400 });
    }
    splits = Array.from(overrideByProgram.entries()).map(([voucherProgramId, amount]) => ({ voucherProgramId, amount }));
  } else {
    const splitMembers: SplitMember[] = members.map((m) => ({
      voucherProgramId: m.voucher_program!.id,
      splitPercent: m.split_percent,
    }));
    splits = splitAmount(totalAmount, splitMembers);
  }

  // Příjemce — najít nebo založit podle telefonu (stejný vzorec jako
  // telefonní aktivace, HARDENING #9).
  const phone = normalizePhone(targetPhone.trim());
  const { data: existingEndUser, error: endUserSelectError } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (endUserSelectError) {
    return NextResponse.json({ ok: false, error: endUserSelectError.message }, { status: 500 });
  }

  let endUserId: string;
  if (existingEndUser) {
    endUserId = existingEndUser.id;
  } else {
    const { data: newEndUser, error: endUserInsertError } = await admin
      .from("vpc_end_users")
      .insert({ phone })
      .select("id")
      .single();
    if (endUserInsertError || !newEndUser) {
      return NextResponse.json(
        { ok: false, error: endUserInsertError?.message ?? "Nepodařilo se založit účet příjemce." },
        { status: 500 }
      );
    }
    endUserId = newEndUser.id;
  }

  // Účty vždy izolované — vícevydavatelská karta nesmí nikdy sdílet účet
  // s existujícím (nebo budoucím) jednovydavatelským voucherem stejného
  // člověka na stejném programu; to by změnilo zůstatek toho druhého
  // vouchru jako vedlejší efekt vydání téhle karty. Stejný mechanismus
  // jako u is_admin_issued.
  const accountsByProgram = new Map<string, string>();
  for (const member of members) {
    const mp = member.voucher_program!;
    const accountResult = await resolveOrCreateAccount(admin, {
      endUserId,
      program: { id: mp.id, currency: mp.currency, balance_mode: mp.balance_mode },
      forceIsolated: true,
    });
    if ("error" in accountResult) {
      return NextResponse.json({ ok: false, error: accountResult.error }, { status: 500 });
    }
    accountsByProgram.set(mp.id, accountResult.accountId);
  }

  const newVoucherId = generateNewVoucherId();
  const voucherCode = generateMultiIssuerVoucherCode();
  const qrPayload = newVoucherId;
  const qrSignature = placeholderQrSignature(qrPayload);

  const { error: voucherInsertError } = await admin.from("vpc_vouchers").insert({
    id: newVoucherId,
    account_id: null,
    voucher_program_id: null,
    multi_issuer_program_id: program.id,
    code: voucherCode,
    qr_payload: qrPayload,
    qr_signature: qrSignature,
    status: "activated",
    valid_from: new Date().toISOString(),
    valid_until: null,
  });

  if (voucherInsertError) {
    return NextResponse.json({ ok: false, error: voucherInsertError.message }, { status: 500 });
  }

  // vpc_voucher_issuer_accounts hned po vytvoření voucheru, PŘED transakcí/
  // ledgerem — DB už negarantuje (po uvolnění account_id na nullable), že
  // vícevydavatelská karta vůbec nějaký účet má. Appka to teď musí ohlídat
  // sama: při selhání smaže právě vytvořený voucher (kompenzační úklid,
  // appka nemá skutečnou DB transakci napříč voláními) a při úspěchu
  // ověří, že řádků vzniklo přesně tolik, kolik má program členů — ne
  // "nějaké", přesně tolik. Viz HARDENING.md.
  const issuerAccountRows = members.map((member) => ({
    voucher_id: newVoucherId,
    account_id: accountsByProgram.get(member.voucher_program!.id)!,
    client_id: member.voucher_program!.client_id,
  }));

  const { data: insertedIssuerAccounts, error: issuerAccountsError } = await admin
    .from("vpc_voucher_issuer_accounts")
    .insert(issuerAccountRows)
    .select("id");

  if (issuerAccountsError || (insertedIssuerAccounts?.length ?? 0) !== issuerAccountRows.length) {
    await admin.from("vpc_vouchers").delete().eq("id", newVoucherId);
    return NextResponse.json(
      { ok: false, error: issuerAccountsError?.message ?? "Založení účtů karty se nezdařilo, vydání zrušeno." },
      { status: 500 }
    );
  }

  const { data: transaction, error: txError } = await admin
    .from("vpc_transactions")
    .insert({
      type: "load",
      idempotency_key: idempotencyKey,
      gross_amount: totalAmount,
      initiated_by: "platform_admin",
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { multi_issuer_voucher_id: newVoucherId, multi_issuer_program_id: program.id },
    })
    .select("id")
    .single();

  if (txError || !transaction) {
    return NextResponse.json({ ok: false, error: txError?.message ?? "Založení transakce se nezdařilo." }, { status: 500 });
  }

  const ledgerRows = splits.map((split) => ({
    account_id: accountsByProgram.get(split.voucherProgramId)!,
    transaction_id: transaction.id,
    direction: "credit" as const,
    amount: split.amount,
    balance_after: split.amount, // nový izolovaný účet, žádný předchozí zůstatek
  }));

  const { error: ledgerError } = await admin.from("vpc_ledger_entries").insert(ledgerRows);
  if (ledgerError) {
    return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: null,
    action: "multi_issuer.voucher_issued",
    target_table: "vpc_vouchers",
    target_id: newVoucherId,
    after_state: { multiIssuerProgramId: program.id, totalAmount, splits },
  });

  return NextResponse.json({ ok: true, voucherId: newVoucherId, code: voucherCode });
}
