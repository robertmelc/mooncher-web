import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { voucherTypeLabel } from "@/lib/vouchers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

type VoucherRow = {
  id: string;
  status: string;
  account_id: string | null;
  issued_to_name: string | null;
  recipient_phone: string | null;
  gifted_by_account_id: string | null;
  voucher_program_id: string;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    client: { name: string } | null;
  } | null;
};

async function logAttempt(
  admin: ReturnType<typeof createAdminClient>,
  token: string,
  action: string,
  afterState?: Record<string, unknown>
) {
  await admin.from("vpc_audit_log").insert({
    actor_type: "system",
    action,
    target_table: "vpc_vouchers",
    target_id: token,
    after_state: afterState ?? null,
  });
}

async function isRateLimited(admin: ReturnType<typeof createAdminClient>, token: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("vpc_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("target_table", "vpc_vouchers")
    .eq("target_id", token)
    .in("action", [
      "voucher.activation_rejected",
      "voucher.activated",
      "voucher.activation_rate_limited",
    ])
    .gte("created_at", since);

  if (error) return false;
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS;
}

async function fetchVoucher(admin: ReturnType<typeof createAdminClient>, token: string) {
  const { data, error } = await admin
    .from("vpc_vouchers")
    .select(
      `id, status, account_id, issued_to_name, recipient_phone, gifted_by_account_id, voucher_program_id,
       voucher_program:vpc_voucher_programs (
         name, voucher_type, currency,
         client:vpc_clients ( name )
       )`
    )
    .eq("id", token)
    .maybeSingle();

  if (error) return { error: error.message, voucher: null };
  return { error: null, voucher: data as unknown as VoucherRow | null };
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;

  if (!UUID_RE.test(token)) {
    return NextResponse.json({ ok: false, error: "Neplatný odkaz." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error, voucher } = await fetchVoucher(admin, token);

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }

  if (!voucher || !voucher.voucher_program || voucher.status !== "issued" || voucher.account_id) {
    return NextResponse.json(
      { ok: false, error: "Voucher nenalezen nebo už byl aktivován." },
      { status: 404 }
    );
  }

  const program = voucher.voucher_program;

  return NextResponse.json({
    ok: true,
    voucher: {
      eyebrow: voucherTypeLabel(program.voucher_type),
      title: program.name,
      subtitle: program.client?.name ?? "",
      issuedToName: voucher.issued_to_name,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;

  if (!UUID_RE.test(token)) {
    return NextResponse.json({ ok: false, error: "Neplatný odkaz." }, { status: 400 });
  }

  const admin = createAdminClient();

  if (await isRateLimited(admin, token)) {
    await logAttempt(admin, token, "voucher.activation_rate_limited");
    return NextResponse.json(
      { ok: false, error: "Příliš mnoho pokusů. Zkuste to prosím později." },
      { status: 429 }
    );
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const rawPhone = body.phone ?? "";
  if (!isValidPhone(rawPhone)) {
    await logAttempt(admin, token, "voucher.activation_rejected", { reason: "invalid_phone" });
    return NextResponse.json({ ok: false, error: "Zadejte platné telefonní číslo." }, { status: 400 });
  }
  const phone = normalizePhone(rawPhone);

  const { error: fetchError, voucher } = await fetchVoucher(admin, token);
  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError }, { status: 500 });
  }
  if (!voucher || !voucher.voucher_program) {
    await logAttempt(admin, token, "voucher.activation_rejected", { reason: "not_found" });
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }
  if (voucher.status !== "issued" || voucher.account_id) {
    await logAttempt(admin, token, "voucher.activation_rejected", { reason: "already_activated" });
    return NextResponse.json({ ok: false, error: "Voucher už byl aktivován." }, { status: 409 });
  }
  if (voucher.recipient_phone && normalizePhone(voucher.recipient_phone) !== phone) {
    await logAttempt(admin, token, "voucher.activation_rejected", { reason: "phone_mismatch" });
    return NextResponse.json(
      { ok: false, error: "Tento voucher je určen jinému telefonnímu číslu." },
      { status: 403 }
    );
  }

  const program = voucher.voucher_program;

  // Najít nebo založit end_usera podle telefonu
  const { data: existingEndUser, error: endUserSelectError } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (endUserSelectError) {
    return NextResponse.json({ ok: false, error: endUserSelectError.message }, { status: 500 });
  }

  let endUserId = existingEndUser?.id as string | undefined;
  if (!endUserId) {
    const { data: newEndUser, error: endUserInsertError } = await admin
      .from("vpc_end_users")
      .insert({ phone })
      .select("id")
      .single();

    if (endUserInsertError) {
      return NextResponse.json({ ok: false, error: endUserInsertError.message }, { status: 500 });
    }
    endUserId = newEndUser.id;
  }

  // Najít nebo založit účet pro (end_user, voucher_program)
  const { data: existingAccount, error: accountSelectError } = await admin
    .from("vpc_accounts")
    .select("id")
    .eq("end_user_id", endUserId)
    .eq("voucher_program_id", voucher.voucher_program_id)
    .maybeSingle();

  if (accountSelectError) {
    return NextResponse.json({ ok: false, error: accountSelectError.message }, { status: 500 });
  }

  let accountId = existingAccount?.id as string | undefined;
  if (!accountId) {
    const { data: newAccount, error: accountInsertError } = await admin
      .from("vpc_accounts")
      .insert({
        end_user_id: endUserId,
        voucher_program_id: voucher.voucher_program_id,
        currency: program.currency,
      })
      .select("id")
      .single();

    if (accountInsertError) {
      return NextResponse.json({ ok: false, error: accountInsertError.message }, { status: 500 });
    }
    accountId = newAccount.id;
  }

  // Atomický přechod issued -> activated — WHERE hlídá race condition / dvojí aktivaci
  const { data: updated, error: updateError } = await admin
    .from("vpc_vouchers")
    .update({ account_id: accountId, status: "activated" })
    .eq("id", token)
    .eq("status", "issued")
    .is("account_id", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    await logAttempt(admin, token, "voucher.activation_rejected", { reason: "race_lost" });
    return NextResponse.json({ ok: false, error: "Voucher už byl aktivován." }, { status: 409 });
  }

  // Účet při vydání ještě neexistoval (vpc_ledger_entries.account_id je
  // NOT NULL), takže ledger credit z vpc_transactions typu 'load' čeká
  // přesně na tenhle okamžik. Dva možné zdroje takové transakce dnes:
  // darování (app-9, metadata.gift_voucher_id) a admin vydání voucheru
  // (metadata.admin_issued_voucher_id) — KAŽDÝ voucher, co se sem dostane,
  // je vždy issued+bez účtu, takže hledáme oba klíče bez podmiňování na
  // gifted_by_account_id (ten u admin vydání není vyplněný). Běží to jen
  // jednou za voucher, protože se sem dostaneme jen při vítězství
  // atomického přechodu výše. Pokud transakce chybí (neměla by), aktivace
  // i tak uspěje — účet už je platně založený — jen se to zaloguje k dohledání.
  const { data: creditTx } = await admin
    .from("vpc_transactions")
    .select("id, gross_amount")
    .or(`metadata->>gift_voucher_id.eq.${token},metadata->>admin_issued_voucher_id.eq.${token}`)
    .maybeSingle();

  if (creditTx) {
    const { error: creditError } = await admin.from("vpc_ledger_entries").insert({
      account_id: accountId,
      transaction_id: creditTx.id,
      direction: "credit",
      amount: creditTx.gross_amount,
      balance_after: creditTx.gross_amount,
    });
    if (creditError) {
      await logAttempt(admin, token, "voucher.gift_credit_failed", { error: creditError.message });
    }
  } else {
    await logAttempt(admin, token, "voucher.gift_credit_missing", {});
  }

  await logAttempt(admin, token, "voucher.activated", { account_id: accountId, status: "activated" });

  return NextResponse.json({ ok: true });
}
