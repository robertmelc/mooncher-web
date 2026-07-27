"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { VoucherCard } from "@/components/VoucherCard";
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
};

const ACTIVE_STATUSES = ["issued", "activated", "partially_used"];

export default function EndUserHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [vouchers, setVouchers] = useState<VoucherCardData[] | null>(null);
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

    async function loadVouchers() {
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
        setVouchers([]);
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

      const accountIds = (accounts ?? []).map((a) => a.id);
      if (accountIds.length === 0) {
        setVouchers([]);
        return;
      }

      const [vouchersRes, ledgerRes] = await Promise.all([
        supabase
          .from("vpc_vouchers")
          .select(
            `id, code, status, account_id,
             voucher_program:vpc_voucher_programs (
               name, voucher_type, currency,
               client:vpc_clients ( name )
             )`
          )
          .in("account_id", accountIds)
          .in("status", ACTIVE_STATUSES),
        supabase
          .from("vpc_ledger_entries")
          .select("account_id, balance_after, created_at")
          .in("account_id", accountIds)
          .order("created_at", { ascending: false }),
      ]);

      if (vouchersRes.error) {
        setError(`Chyba při čtení vpc_vouchers: ${vouchersRes.error.message}`);
        return;
      }
      if (ledgerRes.error) {
        setError(`Chyba při čtení vpc_ledger_entries: ${ledgerRes.error.message}`);
        return;
      }

      const latestBalanceByAccount = new Map<string, number>();
      for (const entry of ledgerRes.data ?? []) {
        if (!latestBalanceByAccount.has(entry.account_id)) {
          latestBalanceByAccount.set(entry.account_id, Number(entry.balance_after));
        }
      }

      const cards: VoucherCardData[] = (
        (vouchersRes.data as unknown as VoucherWithProgram[]) ?? []
      )
        .filter((v) => v.voucher_program)
        .map((v) => {
          const program = v.voucher_program!;
          const balance = latestBalanceByAccount.get(v.account_id) ?? 0;
          return {
            id: v.id,
            eyebrow: voucherTypeLabel(program.voucher_type),
            title: program.name,
            subtitle: program.client?.name ?? "",
            amount: formatCurrency(balance, program.currency),
            code: v.code,
            status: voucherStatusLabel(v.status),
          };
        });

      setVouchers(cards);
    }

    loadVouchers();
  }, [session]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-2.5">
          <MoonMark />
          <h1 className="font-display text-2xl font-bold tracking-tight">Moje vouchery</h1>
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
        ) : vouchers === null ? (
          <p className="font-mono text-sm text-ink-dim">Načítám vouchery…</p>
        ) : vouchers.length === 0 ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Zatím tu nemáte žádný voucher.
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {vouchers.map((v) => (
              <VoucherCard key={v.id} {...v} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
