"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { VoucherCard } from "@/components/VoucherCard";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel, voucherEyebrow } from "@/lib/vouchers";

type VoucherWithProgram = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  message: string | null;
  is_admin_issued: boolean;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    design_config: { tokens?: Record<string, string> } | null;
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
  accentColor?: string;
  logoUrl?: string;
  hasMessage?: boolean;
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

      const [vouchersRes, ledgerRes, multiIssuerRes] = await Promise.all([
        supabase
          .from("vpc_vouchers")
          .select(
            `id, code, status, account_id, message, is_admin_issued,
             voucher_program:vpc_voucher_programs (
               name, voucher_type, currency, design_config,
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
        // Vícevydavatelské karty mají account_id vždy null (viz konverzace),
        // takže je dotaz výše na vpc_vouchers nikdy nenajde — appka by
        // vlastníkovi tiše schovala jeho vlastní kartu (skutečný nález
        // z auditu HARDENING #12/multi-issuer návrhu, 8/2026). Navíc
        // vpc_voucher_issuer_accounts má RLS bez politik (service-role
        // only), takže se to nedá dotáhnout přímo odsud — jde přes
        // vlastní server route.
        fetch("/api/vouchers/multi-issuer", {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        }).then((res) => res.json()),
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

      const singleIssuerCards: VoucherCardData[] = (
        (vouchersRes.data as unknown as VoucherWithProgram[]) ?? []
      )
        .filter((v) => v.voucher_program)
        .map((v) => {
          const program = v.voucher_program!;
          const balance = latestBalanceByAccount.get(v.account_id) ?? 0;
          return {
            id: v.id,
            eyebrow: voucherEyebrow(program.voucher_type, v.is_admin_issued),
            title: program.name,
            subtitle: program.client?.name ?? "",
            amount: formatCurrency(balance, program.currency),
            code: v.code,
            status: voucherStatusLabel(v.status),
            accentColor: program.design_config?.tokens?.brand_color,
            logoUrl: program.design_config?.tokens?.logo || undefined,
            hasMessage: Boolean(v.message),
          };
        });

      type MultiIssuerVoucher = {
        id: string;
        code: string;
        status: string;
        programName: string;
        currency: string;
        totalBalance: number;
      };
      const multiIssuerCards: VoucherCardData[] = (
        (multiIssuerRes.ok ? multiIssuerRes.vouchers : []) as MultiIssuerVoucher[]
      ).map((v) => ({
        id: v.id,
        eyebrow: "Vícevydavatelská karta",
        title: v.programName,
        subtitle: "Rozpis podle firem na detailu",
        amount: formatCurrency(v.totalBalance, v.currency),
        code: v.code,
        status: voucherStatusLabel(v.status),
      }));

      setVouchers([...singleIssuerCards, ...multiIssuerCards]);
    }

    loadVouchers();
  }, [session]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <MoonMark />
            <h1 className="font-display text-2xl font-bold tracking-tight">Moje vouchery</h1>
          </div>
          <Link
            href="/app/settings"
            aria-label="Nastavení"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-line-strong bg-panel2 text-base"
          >
            ⚙
          </Link>
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
              <Link key={v.id} href={`/app/vouchers/${v.id}`} className="block">
                <VoucherCard {...v} />
              </Link>
            ))}
            {vouchers.length >= 2 && (
              <Link
                href="/app/vouchers/transfer"
                className="mt-1 rounded-sm border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Přesun mezi vouchery
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
