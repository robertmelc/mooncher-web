import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSessionFresh } from "@/lib/reauth";

type VoucherRow = {
  id: string;
  status: string;
  account_id: string;
  account: { id: string; end_user_id: string } | null;
  voucher_program: { currency: string } | null;
};

async function fetchVoucher(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data, error } = await admin
    .from("vpc_vouchers")
    .select(
      `id, status, account_id,
       account:vpc_accounts ( id, end_user_id ),
       voucher_program:vpc_voucher_programs ( currency )`
    )
    .eq("id", id)
    .maybeSingle();

  return { error, voucher: data as unknown as VoucherRow | null };
}

async function latestBalance(admin: ReturnType<typeof createAdminClient>, accountId: string) {
  const { data, error } = await admin
    .from("vpc_ledger_entries")
    .select("balance_after")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return { error, balance: 0 };
  return { error: null, balance: data?.[0] ? Number(data[0].balance_after) : 0 };
}

const ACTIVE_STATUSES = ["issued", "activated", "partially_used"];

export async function POST(req: NextRequest) {
  const admin = createAdminClient();

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  // Re-autentizace (B4 §4.4): čerstvost session ověřujeme ze serverem
  // ověřeného JWT, ne z tvrzení klienta — jinak by šlo re-auth gate obejít
  // přímým voláním API.
  if (!isSessionFresh(userData.user.last_sign_in_at)) {
    return NextResponse.json(
      { ok: false, error: "Pro dokončení přesunu se prosím znovu ověřte.", requiresReauth: true },
      { status: 401 }
    );
  }

  let body: {
    fromVoucherId?: string;
    toVoucherId?: string;
    amount?: number;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { fromVoucherId, toVoucherId, amount, idempotencyKey } = body;

  if (!fromVoucherId || !toVoucherId || !idempotencyKey || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ ok: false, error: "Neplatné parametry přesunu." }, { status: 400 });
  }
  if (fromVoucherId === toVoucherId) {
    return NextResponse.json({ ok: false, error: "Zdrojový a cílový voucher musí být různé." }, { status: 400 });
  }

  // Idempotence (B4 §2) — druhý pokus se stejným klíčem se nezpracuje znovu
  const { data: existingTx } = await admin
    .from("vpc_transactions")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingTx) {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const { data: endUser, error: endUserError } = await admin
    .from("vpc_end_users")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (endUserError || !endUser) {
    return NextResponse.json({ ok: false, error: "Účet nenalezen." }, { status: 404 });
  }

  const [{ error: fromError, voucher: fromVoucher }, { error: toError, voucher: toVoucher }] =
    await Promise.all([fetchVoucher(admin, fromVoucherId), fetchVoucher(admin, toVoucherId)]);

  if (fromError || toError) {
    return NextResponse.json({ ok: false, error: (fromError ?? toError)!.message }, { status: 500 });
  }
  if (
    !fromVoucher ||
    !toVoucher ||
    !fromVoucher.account ||
    !toVoucher.account ||
    !fromVoucher.voucher_program ||
    !toVoucher.voucher_program
  ) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }

  // Vlastnictví obou voucherů — defense in depth nad RLS, stejně jako u
  // obrazovek 03/04/05.
  if (fromVoucher.account.end_user_id !== endUser.id || toVoucher.account.end_user_id !== endUser.id) {
    return NextResponse.json({ ok: false, error: "Voucher nenalezen." }, { status: 404 });
  }
  if (!ACTIVE_STATUSES.includes(fromVoucher.status) || !ACTIVE_STATUSES.includes(toVoucher.status)) {
    return NextResponse.json({ ok: false, error: "Voucher není aktivní." }, { status: 409 });
  }
  if (fromVoucher.voucher_program.currency !== toVoucher.voucher_program.currency) {
    return NextResponse.json(
      { ok: false, error: "Nelze přesouvat mezi vouchery v různých měnách." },
      { status: 400 }
    );
  }

  const { error: fromBalanceError, balance: fromBalance } = await latestBalance(admin, fromVoucher.account_id);
  if (fromBalanceError) {
    return NextResponse.json({ ok: false, error: fromBalanceError.message }, { status: 500 });
  }
  if (amount > fromBalance) {
    return NextResponse.json({ ok: false, error: "Nedostatečný zůstatek na zdrojovém voucheru." }, { status: 400 });
  }

  const { error: toBalanceError, balance: toBalance } = await latestBalance(admin, toVoucher.account_id);
  if (toBalanceError) {
    return NextResponse.json({ ok: false, error: toBalanceError.message }, { status: 500 });
  }

  /**
   * ROZHODNUTÍ O ATOMICITĚ (viz konverzace k obrazovce 07, B4 §2):
   * Tohle je sekvence samostatných REST volání, ne jedna DB transakce —
   * Supabase-js/PostgREST neumí víc-řádkovou atomickou transakci napřímo.
   * Vědomě přijaté riziko: pokud stejný uživatel pošle dva přesuny ze
   * STEJNÉHO účtu prakticky současně (např. z dvou zařízení), obě žádosti
   * si můžou přečíst stejný počáteční zůstatek dřív, než se zapíše první
   * ledger entry — teoreticky by tak šlo "utratit" víc, než je zůstatek.
   * Zmírněno: idempotency_key (viz výše) brání duplicitě ze stejného
   * kliknutí/retry, a čerstvá kontrola zůstatku těsně před zápisem snižuje
   * okno na milisekundy. Skutečné řešení je Postgres RPC funkce s row-level
   * lockem (SELECT ... FOR UPDATE) — odloženo do hardening fáze před ostrým
   * nasazením, viz shrnutí v konverzaci.
   */
  const { data: transaction, error: txError } = await admin
    .from("vpc_transactions")
    .insert({
      type: "transfer",
      idempotency_key: idempotencyKey,
      gross_amount: amount,
      platform_fee_amount: 0,
      initiated_by: "end_user",
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { from_account_id: fromVoucher.account_id, to_account_id: toVoucher.account_id },
    })
    .select("id")
    .single();

  if (txError || !transaction) {
    return NextResponse.json({ ok: false, error: txError?.message ?? "Zápis transakce selhal." }, { status: 500 });
  }

  const { error: ledgerError } = await admin.from("vpc_ledger_entries").insert([
    {
      account_id: fromVoucher.account_id,
      transaction_id: transaction.id,
      direction: "debit",
      amount,
      balance_after: fromBalance - amount,
    },
    {
      account_id: toVoucher.account_id,
      transaction_id: transaction.id,
      direction: "credit",
      amount,
      balance_after: toBalance + amount,
    },
  ]);

  if (ledgerError) {
    return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
