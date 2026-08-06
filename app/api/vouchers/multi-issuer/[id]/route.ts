import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountBalances } from "@/lib/ledger";

// Detail jedné vícevydavatelské karty pro jejího držitele — celková
// částka + rozpis podle firem (viz konverzace). Service role, stejný
// důvod jako u seznamu (app/api/vouchers/multi-issuer/route.ts).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  const { data: endUser } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (!endUser) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  const { data: voucher, error: voucherError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, code, status, multi_issuer_program_id,
       multi_issuer_program:vpc_multi_issuer_programs ( name, currency )`
    )
    .eq("id", params.id)
    .maybeSingle();

  if (voucherError) {
    return NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 });
  }
  if (!voucher || !voucher.multi_issuer_program_id) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  const { data: issuerAccounts, error: issuerAccountsError } = await admin
    .from("vpc_voucher_issuer_accounts")
    .select("account_id, client:vpc_clients ( name )")
    .eq("voucher_id", voucher.id);

  if (issuerAccountsError) {
    return NextResponse.json({ ok: false, error: issuerAccountsError.message }, { status: 500 });
  }

  const rows = (issuerAccounts ?? []) as unknown as { account_id: string; client: { name: string } | null }[];

  // Vlastnictví — appka ověří, že aspoň jeden z účtů karty patří
  // volajícímu, defense in depth stejně jako u ostatních voucherů.
  const { data: ownAccountsAmongIssuers } = await admin
    .from("vpc_accounts")
    .select("id")
    .eq("end_user_id", endUser.id)
    .in("id", rows.map((r) => r.account_id));

  if (!ownAccountsAmongIssuers || ownAccountsAmongIssuers.length === 0) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  const balances = await getAccountBalances(admin, rows.map((r) => r.account_id));
  const breakdown = rows.map((r) => ({
    clientName: r.client?.name ?? "",
    balance: balances.get(r.account_id) ?? 0,
  }));
  const totalBalance = breakdown.reduce((sum, b) => sum + b.balance, 0);

  const program = voucher.multi_issuer_program as unknown as { name: string; currency: string } | null;

  return NextResponse.json({
    ok: true,
    voucher: {
      id: voucher.id,
      code: voucher.code,
      status: voucher.status,
      programName: program?.name ?? "",
      currency: program?.currency ?? "CZK",
      totalBalance,
      breakdown,
    },
  });
}
