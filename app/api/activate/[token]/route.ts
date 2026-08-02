import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/email";
import { voucherEyebrow } from "@/lib/vouchers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

type VoucherRow = {
  id: string;
  status: string;
  account_id: string | null;
  issued_to_name: string | null;
  message: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  requires_auth: boolean;
  is_admin_issued: boolean;
  gifted_by_account_id: string | null;
  voucher_program_id: string;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    balance_mode: string;
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
      `id, status, account_id, issued_to_name, message, recipient_phone, recipient_email, requires_auth,
       is_admin_issued, gifted_by_account_id, voucher_program_id,
       voucher_program:vpc_voucher_programs (
         name, voucher_type, currency, balance_mode,
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
      eyebrow: voucherEyebrow(program.voucher_type, voucher.is_admin_issued),
      title: program.name,
      subtitle: program.client?.name ?? "",
      issuedToName: voucher.issued_to_name,
      message: voucher.message,
      requiresAuth: voucher.requires_auth,
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

  const program = voucher.voucher_program;
  let endUserId: string;

  // requires_auth se čte VŽDY z DB řádku, nikdy z requestu — jinak by šlo
  // vynucené přihlášení obejít tím, že klient prostě nepošle Authorization
  // header a pošle phone jako u běžného flow.
  if (voucher.requires_auth) {
    const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      await logAttempt(admin, token, "voucher.activation_rejected", { reason: "auth_required" });
      return NextResponse.json(
        { ok: false, error: "Pro aktivaci tohoto vouchru se musíte přihlásit.", requiresAuth: true },
        { status: 401 }
      );
    }

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      await logAttempt(admin, token, "voucher.activation_rejected", { reason: "auth_invalid" });
      return NextResponse.json(
        { ok: false, error: "Přihlášení vypršelo, přihlaste se prosím znovu.", requiresAuth: true },
        { status: 401 }
      );
    }

    const userEmail = userData.user.email ?? "";
    if (voucher.recipient_email && normalizeEmail(voucher.recipient_email) !== normalizeEmail(userEmail)) {
      await logAttempt(admin, token, "voucher.activation_rejected", { reason: "email_mismatch" });
      return NextResponse.json({ ok: false, error: "Tento voucher je určen jinému e-mailu." }, { status: 403 });
    }

    // Najít nebo založit end_usera podle přihlášeného auth_user_id — jeden
    // atomický upsert (UNIQUE (auth_user_id) + ON CONFLICT), ne select+insert
    // jako u telefonu níž, protože tady na atomicitě skutečně záleží: tohle
    // je první místo v appce, co auth_user_id vůbec zapisuje (HARDENING.md #9).
    const { data: endUser, error: endUserUpsertError } = await admin
      .from("vpc_end_users")
      .upsert({ auth_user_id: userData.user.id, email: userEmail || null }, { onConflict: "auth_user_id" })
      .select("id")
      .single();

    if (endUserUpsertError || !endUser) {
      return NextResponse.json(
        { ok: false, error: endUserUpsertError?.message ?? "Nepodařilo se najít účet." },
        { status: 500 }
      );
    }
    endUserId = endUser.id;
  } else {
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

    if (voucher.recipient_phone && normalizePhone(voucher.recipient_phone) !== phone) {
      await logAttempt(admin, token, "voucher.activation_rejected", { reason: "phone_mismatch" });
      return NextResponse.json(
        { ok: false, error: "Tento voucher je určen jinému telefonnímu číslu." },
        { status: 403 }
      );
    }

    // Najít nebo založit end_usera podle telefonu
    const { data: existingEndUser, error: endUserSelectError } = await admin
      .from("vpc_end_users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (endUserSelectError) {
      return NextResponse.json({ ok: false, error: endUserSelectError.message }, { status: 500 });
    }

    if (existingEndUser) {
      endUserId = existingEndUser.id;
    } else {
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
  }

  // Účet pro (end_user, voucher_program) — u 'pooled' programů (nabíjecí/
  // věrnostní) sdílí všechny vouchery stejného člověka na stejném programu
  // jeden rostoucí zůstatek, proto se existující účet hledá a znovupoužije.
  // U 'isolated' programů (např. Guardian — pevně domluvená hodnota s
  // partnerem pro KAŽDÝ voucher zvlášť) by sdílení účtu dvou různých
  // vouchrů omylem sečetlo jejich smluvně oddělené částky — proto se tu
  // vždy zakládá nový, izolovaný účet, bez ohledu na to, jestli člověk už
  // na tomhle programu nějaký účet má. DB partial unique index
  // (vpc_accounts_pooled_unique, jen WHERE balance_mode='pooled') brání
  // duplicitě u pooled větve, u isolated žádnou uniqueness nevynucuje.
  //
  // is_admin_issued vouchery izolujeme VŽDY, bez ohledu na balance_mode
  // programu — admin vydává hodnotu jménem klienta zvenčí (výhra/prize),
  // nikdy to není dobití existující peněženky, ať vzniká na kterémkoli
  // programu. Bez tohohle by muselo jít spolehnout na to, že admin u
  // KAŽDÉHO programu, kam by mohl vydat výherní voucher, předem nastaví
  // balance_mode='isolated' — reálně se to dvakrát nestalo (Ambassador,
  // Dárkový poukaz) a hodnoty se omylem sloučily s cizím zůstatkem.
  let accountId: string;
  if (program.balance_mode === "isolated" || voucher.is_admin_issued) {
    const { data: newAccount, error: accountInsertError } = await admin
      .from("vpc_accounts")
      .insert({
        end_user_id: endUserId,
        voucher_program_id: voucher.voucher_program_id,
        currency: program.currency,
        balance_mode: "isolated",
      })
      .select("id")
      .single();

    if (accountInsertError) {
      return NextResponse.json({ ok: false, error: accountInsertError.message }, { status: 500 });
    }
    accountId = newAccount.id;
  } else {
    const { data: existingAccount, error: accountSelectError } = await admin
      .from("vpc_accounts")
      .select("id")
      .eq("end_user_id", endUserId)
      .eq("voucher_program_id", voucher.voucher_program_id)
      .maybeSingle();

    if (accountSelectError) {
      return NextResponse.json({ ok: false, error: accountSelectError.message }, { status: 500 });
    }

    if (existingAccount) {
      accountId = existingAccount.id;
    } else {
      const { data: newAccount, error: accountInsertError } = await admin
        .from("vpc_accounts")
        .insert({
          end_user_id: endUserId,
          voucher_program_id: voucher.voucher_program_id,
          currency: program.currency,
          balance_mode: "pooled",
        })
        .select("id")
        .single();

      if (accountInsertError) {
        return NextResponse.json({ ok: false, error: accountInsertError.message }, { status: 500 });
      }
      accountId = newAccount.id;
    }
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
    // Zůstatek PŘED touhle kreditací nemusí být 0 — účet mohl vzniknout dřív
    // a už mít historii (druhý a další dar/admin-voucher na stejný účet).
    // balance_after musí navazovat na poslední skutečný zůstatek, ne jen na
    // výši týhle jedné transakce (viz latestBalance() v transfer/route.ts,
    // stejný vzorec).
    const { data: priorEntries } = await admin
      .from("vpc_ledger_entries")
      .select("balance_after")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1);
    const priorBalance = priorEntries?.[0] ? Number(priorEntries[0].balance_after) : 0;

    const { error: creditError } = await admin.from("vpc_ledger_entries").insert({
      account_id: accountId,
      transaction_id: creditTx.id,
      direction: "credit",
      amount: creditTx.gross_amount,
      balance_after: priorBalance + Number(creditTx.gross_amount),
    });
    if (creditError) {
      await logAttempt(admin, token, "voucher.gift_credit_failed", { error: creditError.message });
    }
  } else {
    await logAttempt(admin, token, "voucher.gift_credit_missing", {});
  }

  await logAttempt(admin, token, "voucher.activated", {
    account_id: accountId,
    status: "activated",
    ...(voucher.requires_auth ? { via: "auth_gated", matched_by: "auth_user_id" } : {}),
  });

  return NextResponse.json({ ok: true });
}
