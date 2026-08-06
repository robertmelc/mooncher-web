import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountBalances } from "@/lib/ledger";

const ACTIVE_STATUSES = ["issued", "activated", "partially_used"];

// Vícevydavatelské karty vlastníka — jde přes service roli, protože
// vpc_voucher_issuer_accounts/vpc_multi_issuer_programs mají RLS zapnuté
// bez politik (stejný vzor jako zbytek jádra), takže je appka nemůže
// číst přímo z prohlížeče přes anon klíč jako jednovydavatelské vouchery.
export async function GET(req: NextRequest) {
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
    return NextResponse.json({ ok: true, vouchers: [] });
  }

  const { data: ownAccounts } = await admin.from("vpc_accounts").select("id").eq("end_user_id", endUser.id);
  const ownAccountIds = new Set((ownAccounts ?? []).map((a) => a.id));
  if (ownAccountIds.size === 0) {
    return NextResponse.json({ ok: true, vouchers: [] });
  }

  const { data: issuerAccounts } = await admin
    .from("vpc_voucher_issuer_accounts")
    .select("voucher_id, account_id")
    .in("account_id", Array.from(ownAccountIds));

  const voucherIds = Array.from(new Set((issuerAccounts ?? []).map((r) => r.voucher_id)));
  if (voucherIds.length === 0) {
    return NextResponse.json({ ok: true, vouchers: [] });
  }

  const { data: vouchers, error: vouchersError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, code, status, multi_issuer_program_id,
       multi_issuer_program:vpc_multi_issuer_programs ( name, currency )`
    )
    .in("id", voucherIds)
    .in("status", ACTIVE_STATUSES);

  if (vouchersError) {
    return NextResponse.json({ ok: false, error: vouchersError.message }, { status: 500 });
  }

  const { data: allIssuerAccounts } = await admin
    .from("vpc_voucher_issuer_accounts")
    .select("voucher_id, account_id")
    .in("voucher_id", voucherIds);

  const accountsByVoucher = new Map<string, string[]>();
  for (const row of allIssuerAccounts ?? []) {
    const list = accountsByVoucher.get(row.voucher_id) ?? [];
    list.push(row.account_id);
    accountsByVoucher.set(row.voucher_id, list);
  }

  const allAccountIds = (allIssuerAccounts ?? []).map((r) => r.account_id);
  const balances = await getAccountBalances(admin, allAccountIds);

  const result = (vouchers ?? []).map((v) => {
    const program = v.multi_issuer_program as unknown as { name: string; currency: string } | null;
    const accountIds = accountsByVoucher.get(v.id) ?? [];
    const total = accountIds.reduce((sum, id) => sum + (balances.get(id) ?? 0), 0);
    return {
      id: v.id,
      code: v.code,
      status: v.status,
      programName: program?.name ?? "",
      currency: program?.currency ?? "CZK",
      totalBalance: total,
    };
  });

  return NextResponse.json({ ok: true, vouchers: result });
}
