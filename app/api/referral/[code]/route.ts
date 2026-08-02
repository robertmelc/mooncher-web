import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrCreateAccount } from "@/lib/accounts";
import { generateVoucherCode, generateNewVoucherId, placeholderQrSignature } from "@/lib/voucherIssuance";

type CodeRow = {
  id: string;
  client_id: string;
  referrer_end_user_id: string;
  voucher_program_id: string;
  end_user: { first_name: string | null; last_name: string | null } | null;
  client: { name: string } | null;
  voucher_program: { currency: string; balance_mode: string; default_validity_days: number | null } | null;
};

async function fetchReferrer(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  endUserId: string
): Promise<string | null> {
  const { data } = await admin
    .from("vpc_referral_links")
    .select("referrer_end_user_id")
    .eq("client_id", clientId)
    .eq("referred_end_user_id", endUserId)
    .maybeSingle();
  return data?.referrer_end_user_id ?? null;
}

// Chodí nahoru po referrer řetězci od `startEndUserId` a hlásí, jestli na
// něj narazí `candidateId` — tedy jestli by nové propojení
// (referrer=startEndUserId, referred=candidateId) uzavřelo cyklus. Řetězec
// má na osobu max. jednoho referrera (UNIQUE(client_id, referred_end_user_id)),
// takže je to O(hloubka), ne drahé; maxHops je jen krajní pojistka proti
// už existujícím historickým cyklům (viz HARDENING #10), ne běžná cesta.
async function isAncestor(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  candidateId: string,
  startEndUserId: string,
  maxHops = 200
): Promise<boolean> {
  let current: string | null = startEndUserId;
  let hops = 0;
  while (current && hops < maxHops) {
    if (current === candidateId) return true;
    current = await fetchReferrer(admin, clientId, current);
    hops += 1;
  }
  return false;
}

async function fetchCode(admin: ReturnType<typeof createAdminClient>, code: string) {
  const { data, error } = await admin
    .from("vpc_referral_codes")
    .select(
      `id, client_id, end_user_id, voucher_program_id,
       end_user:vpc_end_users!end_user_id ( first_name, last_name ),
       client:vpc_clients ( name ),
       voucher_program:vpc_voucher_programs ( currency, balance_mode, default_validity_days )`
    )
    .eq("id", code)
    .maybeSingle();

  if (error) return { error: error.message, row: null };
  if (!data) return { error: null, row: null };
  // referrer_end_user_id se jmenuje v tabulce end_user_id — přejmenování jen
  // pro čitelnost v zbytku souboru.
  const row = { ...data, referrer_end_user_id: data.end_user_id } as unknown as CodeRow;
  return { error: null, row };
}

// Veřejný náhled pozvánky (bez přihlášení) — jen jméno klienta a případně
// křestní jméno pozvatele, žádná citlivá data.
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const admin = createAdminClient();
  const { error, row } = await fetchCode(admin, params.code);

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "Pozvánka nenalezena nebo už neplatí." }, { status: 404 });
  }

  const referrerName = [row.end_user?.first_name, row.end_user?.last_name].filter(Boolean).join(" ") || null;

  return NextResponse.json({
    ok: true,
    referral: { clientName: row.client?.name ?? "", referrerName },
  });
}

// Dokončení propojení po přihlášení — čte se VŽDY podle kódu v URL, ne podle
// ničeho, co by šlo poslat v těle requestu (referrer_end_user_id/program je
// daný tím, čí kód se naskenoval, appka to nikdy nebere od klienta).
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  const { error: codeError, row } = await fetchCode(admin, params.code);
  if (codeError) {
    return NextResponse.json({ ok: false, error: codeError }, { status: 500 });
  }
  if (!row || !row.voucher_program) {
    return NextResponse.json({ ok: false, error: "Pozvánka nenalezena nebo už neplatí." }, { status: 404 });
  }

  // Najít nebo založit end_usera podle přihlášeného auth_user_id — stejný
  // atomický upsert jako u auth-gated aktivace vouchru (viz
  // app/api/activate/[token]/route.ts, HARDENING.md #9).
  const { data: caller, error: callerError } = await admin
    .from("vpc_end_users")
    .upsert(
      { auth_user_id: userData.user.id, email: userData.user.email },
      { onConflict: "auth_user_id" }
    )
    .select("id")
    .single();

  if (callerError || !caller) {
    return NextResponse.json(
      { ok: false, error: callerError?.message ?? "Nepodařilo se najít účet." },
      { status: 500 }
    );
  }

  if (caller.id === row.referrer_end_user_id) {
    return NextResponse.json({ ok: false, error: "Nemůžete pozvat sami sebe." }, { status: 400 });
  }

  // Stromové propojení (per klient) a vydání vouchru (per program) jsou
  // ZÁMĚRNĚ oddělené kontroly idempotence — druhá pozvánka od stejného
  // klienta, ale na jiný program, už nemusí zakládat nový strom-vztah
  // (ten už existuje), ale POŘÁD má založit voucher na tom druhém programu,
  // pokud ho tam příjemce ještě nemá.
  const { data: existingLink } = await admin
    .from("vpc_referral_links")
    .select("id, referrer_end_user_id")
    .eq("client_id", row.client_id)
    .eq("referred_end_user_id", caller.id)
    .maybeSingle();

  if (existingLink && existingLink.referrer_end_user_id !== row.referrer_end_user_id) {
    return NextResponse.json(
      { ok: false, error: "Už jste propojen/a s jiným pozvatelem." },
      { status: 409 }
    );
  }

  if (!existingLink) {
    // Volající zatím nemá v tomhle klientovi žádného referrera (jinak by
    // existingLink existoval) — jediný způsob, jak by teď mohl vzniknout
    // cyklus, je že pozvatel (row.referrer_end_user_id) je ve skutečnosti
    // POTOMEK volajícího (naskenoval kód někoho ve svém vlastním podstromu).
    // Viz HARDENING #10 — přesně tímhle vznikl reálný cyklus 2. 8. 2026.
    const wouldCycle = await isAncestor(admin, row.client_id, caller.id, row.referrer_end_user_id);
    if (wouldCycle) {
      return NextResponse.json(
        { ok: false, error: "Tohle propojení by vytvořilo cyklus ve stromu pozvání." },
        { status: 400 }
      );
    }

    const { data: newLink, error: insertError } = await admin
      .from("vpc_referral_links")
      .insert({
        client_id: row.client_id,
        referrer_end_user_id: row.referrer_end_user_id,
        referred_end_user_id: caller.id,
        source_referral_code_id: row.id,
      })
      .select("id")
      .single();

    if (insertError || !newLink) {
      return NextResponse.json(
        { ok: false, error: insertError?.message ?? "Propojení se nezdařilo." },
        { status: 500 }
      );
    }

    await admin.from("vpc_audit_log").insert({
      actor_type: "end_user",
      actor_id: caller.id,
      action: "referral.linked",
      target_table: "vpc_referral_links",
      target_id: newLink.id,
      after_state: { clientId: row.client_id, referrerEndUserId: row.referrer_end_user_id },
    });
  }

  // Vydání vouchru — gatované na "má už příjemce účet na TOMHLE programu",
  // nezávisle na tom, jestli strom-vztah výše už existoval. Bez týhle
  // kontroly by opakované otevření stejného odkazu vydávalo voucher znovu
  // a znovu (u isolated programů by šlo o neomezené "vítací dary zdarma").
  const { data: existingAccount } = await admin
    .from("vpc_accounts")
    .select("id")
    .eq("end_user_id", caller.id)
    .eq("voucher_program_id", row.voucher_program_id)
    .maybeSingle();

  let voucherId: string | null = null;
  if (!existingAccount) {
    const accountResult = await resolveOrCreateAccount(admin, {
      endUserId: caller.id,
      program: {
        id: row.voucher_program_id,
        currency: row.voucher_program.currency,
        balance_mode: row.voucher_program.balance_mode,
      },
    });
    if ("error" in accountResult) {
      return NextResponse.json({ ok: false, error: accountResult.error }, { status: 500 });
    }

    const newVoucherId = generateNewVoucherId();
    const voucherCode = generateVoucherCode();
    const qrPayload = newVoucherId;
    const qrSignature = placeholderQrSignature(qrPayload);
    const validFrom = new Date();
    const validUntil = row.voucher_program.default_validity_days
      ? new Date(validFrom.getTime() + row.voucher_program.default_validity_days * 24 * 60 * 60 * 1000)
      : null;

    // Voucher vzniká rovnou aktivovaný, s nulovou hodnotou — příjemce je
    // v tomhle requestu už známá, přihlášená identita (na rozdíl od
    // daru/admin-vydání, kde se aktivace řeší odloženě přes samostatný
    // krok pro neznámou budoucí osobu). Nulová hodnota = žádný ledger
    // záznam potřeba, appka bez záznamů zobrazuje 0 Kč jako výchozí stav.
    const { data: newVoucher, error: voucherInsertError } = await admin
      .from("vpc_vouchers")
      .insert({
        id: newVoucherId,
        account_id: accountResult.accountId,
        voucher_program_id: row.voucher_program_id,
        code: voucherCode,
        qr_payload: qrPayload,
        qr_signature: qrSignature,
        status: "activated",
        valid_from: validFrom.toISOString(),
        valid_until: validUntil ? validUntil.toISOString() : null,
      })
      .select("id")
      .single();

    if (voucherInsertError || !newVoucher) {
      return NextResponse.json(
        { ok: false, error: voucherInsertError?.message ?? "Vytvoření vouchru se nezdařilo." },
        { status: 500 }
      );
    }
    voucherId = newVoucher.id;

    await admin.from("vpc_audit_log").insert({
      actor_type: "end_user",
      actor_id: caller.id,
      action: "referral.voucher_issued",
      target_table: "vpc_vouchers",
      target_id: voucherId,
      after_state: { clientId: row.client_id, programId: row.voucher_program_id, sourceCodeId: row.id },
    });
  }

  return NextResponse.json({ ok: true, clientName: row.client?.name ?? "", voucherId });
}
