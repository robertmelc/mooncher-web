import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const REDEEMABLE_STATUSES = ["activated", "partially_used"];

type VoucherRow = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  voucher_program: { name: string; client_id: string; currency: string } | null;
};

// Viz komentář v lib/business-auth.ts — proč tohle jede přes service roli.
// Vlastnictví (client_id shoda) se ověřuje tady i znovu v /redeem — nikdy
// nedáváme operátorovi vědět, jestli kód patří jinému klientovi, nebo
// neexistuje vůbec (stejná generická hláška).
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ ok: false, error: "Chybí kód." }, { status: 400 });
  }

  const { data: voucherRow, error: voucherError } = await admin
    .from("vpc_vouchers")
    .select(
      `id, code, status, account_id,
       voucher_program:vpc_voucher_programs ( name, client_id, currency )`
    )
    .eq("code", code)
    .maybeSingle();

  if (voucherError) {
    return NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 });
  }

  const voucher = voucherRow as unknown as VoucherRow | null;

  if (!voucher || !voucher.voucher_program || voucher.voucher_program.client_id !== operator.clientId) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  if (!REDEEMABLE_STATUSES.includes(voucher.status)) {
    return NextResponse.json(
      { ok: false, error: "Tento voucher nelze teď uplatnit.", status: voucher.status },
      { status: 409 }
    );
  }

  const { data: ledgerEntries, error: ledgerError } = await admin
    .from("vpc_ledger_entries")
    .select("balance_after")
    .eq("account_id", voucher.account_id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (ledgerError) {
    return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
  }

  const balance = ledgerEntries?.[0] ? Number(ledgerEntries[0].balance_after) : 0;

  return NextResponse.json({
    ok: true,
    voucher: {
      id: voucher.id,
      code: voucher.code,
      status: voucher.status,
      programName: voucher.voucher_program.name,
      currency: voucher.voucher_program.currency,
      balance,
    },
  });
}
