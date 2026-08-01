import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { generateVoucherCode, generateNewVoucherId, placeholderQrSignature } from "@/lib/voucherIssuance";

type ProgramRow = {
  id: string;
  client_id: string;
  currency: string;
  default_validity_days: number | null;
  max_load_amount: number | null;
  client: { name: string } | null;
};

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  let body: {
    clientId?: string;
    programId?: string;
    amount?: number;
    recipientPhone?: string;
    message?: string;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { clientId, programId, amount, recipientPhone, message, idempotencyKey } = body;

  if (!clientId || !programId || !idempotencyKey || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Neplatné parametry vydání." }, { status: 400 });
  }

  let phone: string | null = null;
  if (recipientPhone && recipientPhone.trim()) {
    if (!isValidPhone(recipientPhone)) {
      return NextResponse.json({ ok: false, error: "Zadejte platné telefonní číslo příjemce." }, { status: 400 });
    }
    phone = normalizePhone(recipientPhone);
  }

  // Idempotence — druhý pokus se stejným klíčem vrátí id už vytvořeného
  // vouchru, ne novou duplicitu (stejný vzorec jako app-9).
  const { data: existingTx } = await admin
    .from("vpc_transactions")
    .select("metadata")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingTx) {
    const existingVoucherId = (existingTx.metadata as { admin_issued_voucher_id?: string } | null)
      ?.admin_issued_voucher_id;
    return NextResponse.json({ ok: true, alreadyProcessed: true, voucherId: existingVoucherId ?? null });
  }

  const { data: programRow, error: programError } = await admin
    .from("vpc_voucher_programs")
    .select("id, client_id, currency, default_validity_days, max_load_amount, client:vpc_clients ( name )")
    .eq("id", programId)
    .maybeSingle();

  if (programError) {
    return NextResponse.json({ ok: false, error: programError.message }, { status: 500 });
  }
  const program = programRow as unknown as ProgramRow | null;
  // Defense in depth — program musí skutečně patřit vybranému klientovi,
  // ne jen tomu, co přišlo z <select> na klientovi.
  if (!program || program.client_id !== clientId) {
    return NextResponse.json({ ok: false, error: "Program nenalezen." }, { status: 404 });
  }
  if (program.max_load_amount && amount > program.max_load_amount) {
    return NextResponse.json(
      { ok: false, error: `Maximální částka pro tento program je ${program.max_load_amount}.` },
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
  // metadata.admin_issued_voucher_id. initiated_by='platform_admin' a
  // metadata.reason dělají z tohohle zápisu na první pohled rozpoznatelné
  // administrativní vydání, ne běžnou transakci programu (viz konverzace
  // k auditovatelnosti).
  const { data: transaction, error: txError } = await admin
    .from("vpc_transactions")
    .insert({
      type: "load",
      idempotency_key: idempotencyKey,
      gross_amount: amount,
      platform_fee_amount: 0,
      initiated_by: "platform_admin",
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: {
        admin_issued_voucher_id: newVoucherId,
        admin_email: result.email,
        reason: "admin_issued",
        client_id: clientId,
      },
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
    voucher_program_id: program.id,
    code,
    qr_payload: qrPayload,
    qr_signature: qrSignature,
    status: "issued",
    message: message?.trim() || null,
    valid_from: validFrom.toISOString(),
    valid_until: validUntil ? validUntil.toISOString() : null,
  });

  if (voucherInsertError) {
    return NextResponse.json({ ok: false, error: voucherInsertError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.voucher_issued",
    target_table: "vpc_vouchers",
    target_id: newVoucherId,
    after_state: {
      clientId,
      clientName: program.client?.name ?? null,
      programId,
      amount,
      currency: program.currency,
      recipientPhone: phone,
    },
  });

  return NextResponse.json({ ok: true, voucherId: newVoucherId });
}
