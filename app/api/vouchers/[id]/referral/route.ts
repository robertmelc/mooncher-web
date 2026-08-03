import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCurrentLevel, resolveNextLevel, resolveDefaultProgram } from "@/lib/referrals";

type VoucherRow = {
  id: string;
  voucher_program_id: string;
  account: { end_user_id: string } | null;
  voucher_program: { client_id: string } | null;
};

async function resolveContext(admin: ReturnType<typeof createAdminClient>, req: NextRequest, voucherId: string) {
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return { error: NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 }) };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return { error: NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 }) };
  }

  const { data: endUser, error: endUserError } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (endUserError || !endUser) {
    return { error: NextResponse.json({ ok: false, error: "Účet nenalezen." }, { status: 404 }) };
  }

  const { data: voucherRow, error: voucherError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, voucher_program_id, account:vpc_accounts!account_id ( end_user_id ), voucher_program:vpc_voucher_programs ( client_id )`
    )
    .eq("id", voucherId)
    .maybeSingle();

  if (voucherError) {
    return { error: NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 }) };
  }
  const voucher = voucherRow as unknown as VoucherRow | null;
  if (!voucher || !voucher.account || !voucher.voucher_program) {
    return { error: NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 }) };
  }
  // Vlastnictví — defense in depth nad RLS, stejně jako u transferu/daru.
  if (voucher.account.end_user_id !== endUser.id) {
    return { error: NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 }) };
  }

  return { endUserId: endUser.id, clientId: voucher.voucher_program.client_id, programId: voucher.voucher_program_id };
}

async function buildStatus(
  admin: ReturnType<typeof createAdminClient>,
  endUserId: string,
  clientId: string,
  code: string | null
) {
  // Úrovně a počet přímých pozvání zůstávají per klient (strom) — jen kód
  // samotný je teď per program, viz konverzace k rozšíření o vydávání vouchru.
  const { data: levels } = await admin
    .from("vpc_referral_levels")
    .select("id, name, threshold")
    .eq("client_id", clientId);

  const { count: directCount } = await admin
    .from("vpc_referral_links")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("referrer_end_user_id", endUserId);

  const levelList = levels ?? [];
  const count = directCount ?? 0;

  return {
    ok: true,
    enabled: true,
    code,
    directCount: count,
    currentLevel: resolveCurrentLevel(count, levelList),
    nextLevel: resolveNextLevel(count, levelList),
  };
}

// Stav pozvánkového programu pro tenhle konkrétní voucher — bez vedlejších
// efektů, kód se tu jen ČTE, nezakládá.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const ctx = await resolveContext(admin, req, params.id);
  if ("error" in ctx) return ctx.error;

  // client_id nemá nastavený žádný stupeň, NEBO nemá vybraný základní
  // program pro pozvané → appka odkaz na pozvání vůbec nenabízí. Obojí
  // je vyžadované, ne volitelné s fallbackem — jinak by šlo appku dostat
  // do stavu "kódy se generují, ale join by neměl co vydat".
  const { count: levelCount } = await admin
    .from("vpc_referral_levels")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId);

  const defaultProgram = await resolveDefaultProgram(admin, ctx.clientId);

  if (!levelCount || !defaultProgram) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  // Kód je vázaný na konkrétní program (voucher_program_id), ne jen na
  // klienta — stejný člověk může mít různé kódy pro různé programy
  // stejného klienta, každý zakládá jiný typ vouchru novému člověku.
  const { data: existingCode } = await admin
    .from("vpc_referral_codes")
    .select("id")
    .eq("end_user_id", ctx.endUserId)
    .eq("voucher_program_id", ctx.programId)
    .maybeSingle();

  return NextResponse.json(await buildStatus(admin, ctx.endUserId, ctx.clientId, existingCode?.id ?? null));
}

// Založí (nebo najde existující) pozvánkový kód pro tenhle konkrétní
// program — jediné místo v appce, co do vpc_referral_codes zapisuje.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const ctx = await resolveContext(admin, req, params.id);
  if ("error" in ctx) return ctx.error;

  const { count: levelCount } = await admin
    .from("vpc_referral_levels")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId);

  const defaultProgram = await resolveDefaultProgram(admin, ctx.clientId);

  if (!levelCount || !defaultProgram) {
    return NextResponse.json({ ok: false, error: "Tenhle klient nemá pozvánkový program zapnutý." }, { status: 400 });
  }

  const { data: existingCode } = await admin
    .from("vpc_referral_codes")
    .select("id")
    .eq("end_user_id", ctx.endUserId)
    .eq("voucher_program_id", ctx.programId)
    .maybeSingle();

  let codeId: string;
  if (existingCode) {
    codeId = existingCode.id;
  } else {
    const { data: newCode, error: insertError } = await admin
      .from("vpc_referral_codes")
      .insert({ end_user_id: ctx.endUserId, client_id: ctx.clientId, voucher_program_id: ctx.programId })
      .select("id")
      .single();

    if (insertError || !newCode) {
      return NextResponse.json(
        { ok: false, error: insertError?.message ?? "Nepodařilo se vytvořit pozvánku." },
        { status: 500 }
      );
    }
    codeId = newCode.id;
  }

  return NextResponse.json(await buildStatus(admin, ctx.endUserId, ctx.clientId, codeId));
}
