import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type VoucherRow = {
  id: string;
  voucher_program_id: string;
  account: { end_user_id: string } | null;
  voucher_program: { client_id: string } | null;
};

// Sdílený vlastnický kontext (endUserId/clientId/programId) pro voucher —
// používá GET/POST /api/vouchers/[id]/referral i sesterské sms/invites
// endpointy. V samostatném lib souboru, ne exportované z route.ts — Next.js
// App Router route soubory smí exportovat jen GET/POST/... a pár config
// klíčů, žádné vlastní pomocné funkce.
export async function resolveContext(admin: ReturnType<typeof createAdminClient>, req: NextRequest, voucherId: string) {
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
