import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";
import { getAccountBalance, getAccountBalances } from "@/lib/ledger";

const REDEEMABLE_STATUSES = ["activated", "partially_used"];

type VoucherRow = {
  id: string;
  code: string;
  status: string;
  account_id: string | null;
  multi_issuer_program_id: string | null;
  voucher_program: { name: string; client_id: string; currency: string } | null;
};

type IssuerAccountRow = { account_id: string; client_id: string; client: { name: string } | null };

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
      `id, code, status, account_id, multi_issuer_program_id,
       voucher_program:vpc_voucher_programs ( name, client_id, currency )`
    )
    .eq("code", code)
    .maybeSingle();

  if (voucherError) {
    return NextResponse.json({ ok: false, error: voucherError.message }, { status: 500 });
  }

  const voucher = voucherRow as unknown as VoucherRow | null;

  // Vícevydavatelská karta — jiná cesta hned od začátku, nesahá na
  // jednovydavatelskou logiku pod tímhle blokem vůbec. voucher_program je
  // u ní vždy null (viz konverzace), takže bez týhle větve by spadla do
  // stejné "Voucher nenalezen" větve jako neexistující kód.
  if (voucher?.multi_issuer_program_id) {
    if (!REDEEMABLE_STATUSES.includes(voucher.status)) {
      return NextResponse.json(
        { ok: false, error: "Tento voucher nelze teď uplatnit.", status: voucher.status },
        { status: 409 }
      );
    }

    const { data: issuerAccountsData, error: issuerAccountsError } = await admin
      .from("vpc_voucher_issuer_accounts")
      .select("account_id, client_id, client:vpc_clients ( name )")
      .eq("voucher_id", voucher.id);

    if (issuerAccountsError) {
      return NextResponse.json({ ok: false, error: issuerAccountsError.message }, { status: 500 });
    }

    const issuerAccounts = (issuerAccountsData ?? []) as unknown as IssuerAccountRow[];
    const ownAccount = issuerAccounts.find((a) => a.client_id === operator.clientId);

    if (!ownAccount) {
      // Karta existuje, ale tenhle klient v její skupině vůbec není —
      // stejná generická hláška jako u cizího/neexistujícího kódu.
      return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
    }

    const { data: programData } = await admin
      .from("vpc_multi_issuer_programs")
      .select("name, currency")
      .eq("id", voucher.multi_issuer_program_id)
      .maybeSingle();

    const balances = await getAccountBalances(admin, issuerAccounts.map((a) => a.account_id));
    const ownBalance = balances.get(ownAccount.account_id) ?? 0;
    const totalBalance = Array.from(balances.values()).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      ok: true,
      voucher: {
        id: voucher.id,
        code: voucher.code,
        status: voucher.status,
        isMultiIssuer: true,
        programName: programData?.name ?? "",
        currency: programData?.currency ?? "CZK",
        balance: ownBalance,
        totalBalance,
        clientName: ownAccount.client?.name ?? "",
      },
    });
  }

  if (!voucher || !voucher.voucher_program || voucher.voucher_program.client_id !== operator.clientId) {
    // Není to platební voucher — možná je to výherní list z charitativní
    // vrstvy (chr_winning_tickets), který se u pokladny záměrně nedá
    // uplatnit. Obecné "Voucher nenalezen" by tenhle konkrétní, časný
    // omyl u pultu nevysvětlilo — viz konverzace k výhernímu listu.
    const { data: winningTicket } = await admin
      .from("chr_winning_tickets")
      .select("id")
      .eq("list_number", code)
      .eq("client_id", operator.clientId)
      .maybeSingle();

    if (winningTicket) {
      return NextResponse.json(
        { ok: false, error: "Tohle je výherní list, ne platební voucher — nedá se jím platit, jen si přes něj řeknete o výplatu výhry." },
        { status: 409 }
      );
    }

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
