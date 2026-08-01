import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSessionFresh } from "@/lib/reauth";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { generateVoucherCode, generateNewVoucherId, placeholderQrSignature } from "@/lib/voucherIssuance";

const ACTIVE_STATUSES = ["issued", "activated", "partially_used"];

type SourceVoucherRow = {
  id: string;
  status: string;
  account_id: string;
  account: { id: string; end_user_id: string } | null;
  voucher_program: {
    id: string;
    currency: string;
    default_validity_days: number | null;
    max_load_amount: number | null;
    balance_mode: string;
  } | null;
};

export async function POST(req: NextRequest) {
  const admin = createAdminClient();

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  // Re-autentizace (B4 §4.4) — darování je finanční commit stejně jako
  // přesun (screen 07), stejná re-auth gate.
  if (!isSessionFresh(userData.user.last_sign_in_at)) {
    return NextResponse.json(
      { ok: false, error: "Pro dokončení darování se prosím znovu ověřte.", requiresReauth: true },
      { status: 401 }
    );
  }

  let body: {
    voucherId?: string;
    recipientPhone?: string;
    recipientName?: string;
    message?: string;
    amount?: number;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { voucherId, recipientPhone, recipientName, message, amount, idempotencyKey } = body;

  if (!voucherId || !idempotencyKey || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Neplatné parametry daru." }, { status: 400 });
  }
  if (!recipientPhone || !isValidPhone(recipientPhone)) {
    return NextResponse.json({ ok: false, error: "Zadejte platné telefonní číslo příjemce." }, { status: 400 });
  }
  const phone = normalizePhone(recipientPhone);

  // Idempotence — druhý pokus se stejným klíčem vrátí id už vytvořeného daru,
  // ne novou duplicitu (stejný vzorec jako transfer, ale tady navíc musíme
  // klientovi vrátit ID nového vouchru, aby šlo znovu zobrazit aktivační odkaz).
  const { data: existingTx } = await admin
    .from("vpc_transactions")
    .select("metadata")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingTx) {
    const existingVoucherId = (existingTx.metadata as { gift_voucher_id?: string } | null)?.gift_voucher_id;
    return NextResponse.json({ ok: true, alreadyProcessed: true, voucherId: existingVoucherId ?? null });
  }

  const { data: endUser, error: endUserError } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (endUserError || !endUser) {
    return NextResponse.json({ ok: false, error: "Účet nenalezen." }, { status: 404 });
  }

  const { data: sourceVoucher, error: sourceError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, status, account_id,
       account:vpc_accounts!account_id ( id, end_user_id ),
       voucher_program:vpc_voucher_programs ( id, currency, default_validity_days, max_load_amount, balance_mode )`
    )
    .eq("id", voucherId)
    .maybeSingle();

  if (sourceError) {
    return NextResponse.json({ ok: false, error: sourceError.message }, { status: 500 });
  }
  const source = sourceVoucher as unknown as SourceVoucherRow | null;
  if (!source || !source.account || !source.voucher_program) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }
  // Vlastnictví — defense in depth nad RLS, stejně jako u transferu.
  if (source.account.end_user_id !== endUser.id) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }
  if (!ACTIVE_STATUSES.includes(source.status)) {
    return NextResponse.json({ ok: false, error: "Voucher není aktivní." }, { status: 409 });
  }

  const program = source.voucher_program;
  // 'isolated' program = pevně domluvená hodnota vouchru pro konkrétního
  // partnera (viz Guardian) — darování by tuhle hodnotu uměle vykrajovalo,
  // stejná logika jako u přesunu.
  if (program.balance_mode === "isolated") {
    return NextResponse.json(
      { ok: false, error: "Darování není u tohoto typu vouchru povoleno." },
      { status: 400 }
    );
  }
  if (program.max_load_amount && amount > program.max_load_amount) {
    return NextResponse.json(
      { ok: false, error: `Maximální částka daru je ${program.max_load_amount}.` },
      { status: 400 }
    );
  }

  const newVoucherId = generateNewVoucherId();
  const code = generateVoucherCode();
  const qrPayload = newVoucherId;
  const qrSignature = placeholderQrSignature(qrPayload);

  const validFrom = new Date();
  const validUntil = program.default_validity_days
    ? new Date(validFrom.getTime() + program.default_validity_days * 24 * 60 * 60 * 1000)
    : null;

  // Transakce se zapíše BEZ ledger entry — účet příjemce ještě neexistuje
  // (vpc_ledger_entries.account_id je NOT NULL). Credit se dopíše až při
  // aktivaci (viz app/api/activate/[token]/route.ts), dohledaný přes
  // metadata.gift_voucher_id.
  const { data: transaction, error: txError } = await admin
    .from("vpc_transactions")
    .insert({
      type: "load",
      idempotency_key: idempotencyKey,
      gross_amount: amount,
      platform_fee_amount: 0,
      initiated_by: "end_user",
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { gift_voucher_id: newVoucherId, gifted_by_account_id: source.account_id },
    })
    .select("id")
    .single();

  if (txError || !transaction) {
    return NextResponse.json({ ok: false, error: txError?.message ?? "Zápis transakce selhal." }, { status: 500 });
  }

  const { error: voucherInsertError } = await admin.from("vpc_vouchers").insert({
    id: newVoucherId,
    account_id: null,
    recipient_phone: phone,
    gifted_by_account_id: source.account_id,
    voucher_program_id: program.id,
    code,
    qr_payload: qrPayload,
    qr_signature: qrSignature,
    status: "issued",
    issued_to_name: recipientName?.trim() || null,
    message: message?.trim() || null,
    valid_from: validFrom.toISOString(),
    valid_until: validUntil ? validUntil.toISOString() : null,
  });

  if (voucherInsertError) {
    return NextResponse.json({ ok: false, error: voucherInsertError.message }, { status: 500 });
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "end_user",
    actor_id: endUser.id,
    action: "voucher.gifted",
    target_table: "vpc_vouchers",
    target_id: newVoucherId,
    after_state: { recipientPhone: phone, amount, fromVoucherId: voucherId },
  });

  return NextResponse.json({ ok: true, voucherId: newVoucherId });
}
