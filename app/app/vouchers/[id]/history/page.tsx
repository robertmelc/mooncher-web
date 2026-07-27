"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { TransactionRow } from "@/components/TransactionRow";
import { formatCurrency, formatFeedDate } from "@/lib/format";
import { transactionTypeLabel } from "@/lib/transactions";

type VoucherRow = {
  id: string;
  account_id: string;
  voucher_program: { currency: string } | null;
};

type LedgerRow = {
  id: number;
  direction: "credit" | "debit";
  amount: number;
  created_at: string;
  transaction_id: string;
  transaction: { type: string } | null;
};

type FeedRow = {
  id: number;
  label: string;
  dateLabel: string;
  amountLabel: string;
  positive: boolean;
};

export default function VoucherHistoryPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [feed, setFeed] = useState<FeedRow[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    async function loadFeed() {
      const { data: endUser, error: endUserError } = await supabase
        .from("vpc_end_users")
        .select("id")
        .eq("auth_user_id", session!.user.id)
        .maybeSingle();

      if (endUserError) {
        setError(`Chyba při čtení vpc_end_users: ${endUserError.message}`);
        return;
      }
      if (!endUser) {
        setFeed(null);
        return;
      }

      const { data: accounts, error: accountsError } = await supabase
        .from("vpc_accounts")
        .select("id")
        .eq("end_user_id", endUser.id);

      if (accountsError) {
        setError(`Chyba při čtení vpc_accounts: ${accountsError.message}`);
        return;
      }

      const ownAccountIds = new Set((accounts ?? []).map((a) => a.id));
      if (ownAccountIds.size === 0) {
        setFeed(null);
        return;
      }

      const { data: voucherRow, error: voucherError } = await supabase
        .from("vpc_vouchers")
        .select("id, account_id, voucher_program:vpc_voucher_programs ( currency )")
        .eq("id", params.id)
        .maybeSingle();

      if (voucherError) {
        setError(`Chyba při čtení vpc_vouchers: ${voucherError.message}`);
        return;
      }

      const voucher = voucherRow as unknown as VoucherRow | null;

      if (!voucher || !voucher.voucher_program || !ownAccountIds.has(voucher.account_id)) {
        setFeed(null);
        return;
      }

      const currency = voucher.voucher_program.currency;

      const { data: ledgerEntries, error: ledgerError } = await supabase
        .from("vpc_ledger_entries")
        .select("id, direction, amount, created_at, transaction_id, transaction:vpc_transactions ( type )")
        .eq("account_id", voucher.account_id)
        .order("created_at", { ascending: false });

      if (ledgerError) {
        setError(`Chyba při čtení vpc_ledger_entries: ${ledgerError.message}`);
        return;
      }

      const entries = (ledgerEntries as unknown as LedgerRow[]) ?? [];
      const redeemTxIds = entries
        .filter((e) => e.transaction?.type === "redeem")
        .map((e) => e.transaction_id);

      let merchantByTxId = new Map<string, string>();
      if (redeemTxIds.length > 0) {
        const { data: redemptions, error: redemptionsError } = await supabase
          .from("vpc_redemptions")
          .select("transaction_id, merchant_ref")
          .in("transaction_id", redeemTxIds);

        if (redemptionsError) {
          setError(`Chyba při čtení vpc_redemptions: ${redemptionsError.message}`);
          return;
        }

        merchantByTxId = new Map(
          (redemptions ?? [])
            .filter((r) => r.merchant_ref)
            .map((r) => [r.transaction_id, r.merchant_ref as string])
        );
      }

      const rows: FeedRow[] = entries.map((entry) => {
        const type = entry.transaction?.type ?? "adjustment";
        const label =
          type === "redeem"
            ? merchantByTxId.get(entry.transaction_id) ?? transactionTypeLabel("redeem")
            : transactionTypeLabel(type);
        const positive = entry.direction === "credit";

        return {
          id: entry.id,
          label,
          dateLabel: formatFeedDate(entry.created_at),
          amountLabel: `${positive ? "+" : "−"} ${formatCurrency(Number(entry.amount), currency)}`,
          positive,
        };
      });

      setFeed(rows);
    }

    loadFeed();
  }, [session, params.id]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-3">
          <Link
            href={`/app/vouchers/${params.id}`}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-strong text-ink-dim"
            aria-label="Zpět"
          >
            ‹
          </Link>
          <h1 className="font-display text-xl font-bold tracking-tight">Historie</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href="/app/login" className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : feed === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám historii…</p>
        ) : feed === null ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Voucher nenalezen.
          </div>
        ) : feed.length === 0 ? (
          <p className="text-sm text-ink-faint">Zatím žádné pohyby.</p>
        ) : (
          <div className="flex flex-col">
            {feed.map((row) => (
              <TransactionRow key={row.id} {...row} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
