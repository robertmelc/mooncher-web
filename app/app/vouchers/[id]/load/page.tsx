"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { VoucherCard } from "@/components/VoucherCard";
import { VoucherSlider } from "@/components/VoucherSlider";
import { PayMethodRow } from "@/components/PayMethodRow";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel, voucherTypeLabel } from "@/lib/vouchers";

type VoucherWithProgram = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    client: { name: string } | null;
  } | null;
};

type VoucherCardData = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
  currency: string;
};

const PAY_METHODS = [
  { key: "card", icon: "💳", label: "Platební karta" },
  { key: "apple_pay", icon: "A", label: "Apple Pay" },
  { key: "google_pay", icon: "G", label: "Google Pay" },
  { key: "bank_transfer", icon: "🏦", label: "Bankovní převod" },
];

export default function VoucherLoadPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [voucher, setVoucher] = useState<VoucherCardData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(500);
  const [payMethod, setPayMethod] = useState("card");
  const [showPlaceholder, setShowPlaceholder] = useState(false);

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

    async function loadVoucher() {
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
        setVoucher(null);
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
        setVoucher(null);
        return;
      }

      const { data: voucherRow, error: voucherError } = await supabase
        .from("vpc_vouchers")
        .select(
          `id, code, status, account_id,
           voucher_program:vpc_voucher_programs (
             name, voucher_type, currency,
             client:vpc_clients ( name )
           )`
        )
        .eq("id", params.id)
        .maybeSingle();

      if (voucherError) {
        setError(`Chyba při čtení vpc_vouchers: ${voucherError.message}`);
        return;
      }

      const row = voucherRow as unknown as VoucherWithProgram | null;

      if (!row || !row.voucher_program || !ownAccountIds.has(row.account_id)) {
        setVoucher(null);
        return;
      }

      const { data: ledgerEntries, error: ledgerError } = await supabase
        .from("vpc_ledger_entries")
        .select("balance_after, created_at")
        .eq("account_id", row.account_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (ledgerError) {
        setError(`Chyba při čtení vpc_ledger_entries: ${ledgerError.message}`);
        return;
      }

      const balance = ledgerEntries?.[0] ? Number(ledgerEntries[0].balance_after) : 0;
      const program = row.voucher_program;

      setVoucher({
        id: row.id,
        eyebrow: voucherTypeLabel(program.voucher_type),
        title: program.name,
        subtitle: program.client?.name ?? "",
        amount: formatCurrency(balance, program.currency),
        code: row.code,
        status: voucherStatusLabel(row.status),
        currency: program.currency,
      });
    }

    loadVoucher();
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
          <h1 className="font-display text-xl font-bold tracking-tight">Nabít voucher</h1>
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
        ) : voucher === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám voucher…</p>
        ) : voucher === null ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Voucher nenalezen.
          </div>
        ) : (
          <>
            <VoucherCard {...voucher} />

            <div className="mt-2 text-center text-[11.5px] text-ink-faint">Částka k dobití</div>
            <div className="text-center font-display text-3xl font-extrabold">
              {formatCurrency(amount, voucher.currency)}
            </div>
            <VoucherSlider min={0} max={10000} step={100} value={amount} onChange={setAmount} />
            <div className="-mt-2 flex justify-between text-[11.5px] text-ink-faint">
              <span>{formatCurrency(0, voucher.currency)}</span>
              <span>{formatCurrency(10000, voucher.currency)}</span>
            </div>

            <div className="mt-3 text-[11.5px] text-ink-faint">Způsob platby</div>
            <div className="flex flex-col">
              {PAY_METHODS.map((m) => (
                <PayMethodRow
                  key={m.key}
                  icon={m.icon}
                  label={m.label}
                  selected={payMethod === m.key}
                  onClick={() => setPayMethod(m.key)}
                />
              ))}
            </div>

            <Button onClick={() => setShowPlaceholder(true)} className="mt-2">
              Zaplatit
            </Button>

            {showPlaceholder && (
              <p className="text-center text-[11.5px] text-teal">Platby budou dostupné brzy.</p>
            )}

            <p className="text-center text-[11.5px] text-ink-faint">Zpracováno přes Stripe</p>
          </>
        )}
      </div>
    </main>
  );
}
