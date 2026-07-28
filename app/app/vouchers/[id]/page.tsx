"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { VoucherCard } from "@/components/VoucherCard";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel, voucherTypeLabel } from "@/lib/vouchers";

type VoucherWithProgram = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  valid_until: string | null;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    client: { name: string } | null;
  } | null;
};

type VoucherDetail = {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
  validUntil?: string;
};

export default function VoucherDetailPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [voucher, setVoucher] = useState<VoucherDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

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
          `id, code, status, account_id, valid_until,
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

      // Defense in depth: i kdyby RLS omylem propustila cizí řádek, ověříme
      // vlastnictví i tady — cizí/neexistující voucher se chová stejně jako "nenalezeno".
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
        validUntil: row.valid_until
          ? new Date(row.valid_until).toLocaleDateString("cs-CZ")
          : undefined,
      });
    }

    loadVoucher();
  }, [session, params.id]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-3">
          <Link
            href="/app"
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-strong text-ink-dim"
            aria-label="Zpět"
          >
            ‹
          </Link>
          <h1 className="font-display text-xl font-bold tracking-tight">Detail voucheru</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/app/vouchers/${params.id}`)}`}
              className="text-teal underline"
            >
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
            <VoucherCard {...voucher} flipped={flipped} />

            <div className="flex justify-center">
              <span className="badge">{voucher.status}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                ↻ Otočit kartu
              </button>
              <Link
                href={`/app/vouchers/${voucher.id}/history`}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Historie
              </Link>
              <Link
                href={`/app/vouchers/${voucher.id}/load`}
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Nabít
              </Link>
              <Link
                href="/app/vouchers/transfer"
                className="rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-center text-[11.5px] font-medium text-ink-dim"
              >
                Přesun
              </Link>
            </div>

            {!flipped && (
              <div className="flex flex-col items-center gap-3">
                <div className="qr" aria-hidden="true" />
                <p className="text-[11.5px] text-ink-dim">Naskenujte u pokladny</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
