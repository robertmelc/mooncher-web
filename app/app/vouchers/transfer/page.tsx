"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/lib/format";
import { isSessionFresh } from "@/lib/reauth";

type VoucherWithProgram = {
  id: string;
  status: string;
  account_id: string;
  voucher_program: { name: string; currency: string; client: { name: string } | null } | null;
};

type VoucherOption = {
  id: string;
  title: string;
  balance: number;
  currency: string;
};

const ACTIVE_STATUSES = ["issued", "activated", "partially_used"];

export default function TransferPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [vouchers, setVouchers] = useState<VoucherOption[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reauthSending, setReauthSending] = useState(false);
  const [reauthSent, setReauthSent] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) setReauthSent(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadVouchers = useCallback(async () => {
    if (!session) return;

    const { data: endUser, error: endUserError } = await supabase
      .from("vpc_end_users")
      .select("id")
      .eq("auth_user_id", session.user.id)
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
          `id, status, account_id,
           voucher_program:vpc_voucher_programs ( name, currency, client:vpc_clients ( name ) )`
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

    const options: VoucherOption[] = ((vouchersRes.data as unknown as VoucherWithProgram[]) ?? [])
      .filter((v) => v.voucher_program)
      .map((v) => ({
        id: v.id,
        title: `${v.voucher_program!.name}${v.voucher_program!.client ? ` — ${v.voucher_program!.client.name}` : ""}`,
        balance: latestBalanceByAccount.get(v.account_id) ?? 0,
        currency: v.voucher_program!.currency,
      }));

    setVouchers(options);
  }, [session]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  async function handleResendMagicLink() {
    if (!session?.user.email) return;
    setReauthSending(true);
    await supabase.auth.signInWithOtp({
      email: session.user.email,
      options: { emailRedirectTo: `${window.location.origin}/app/vouchers/transfer` },
    });
    setReauthSending(false);
    setReauthSent(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    const numericAmount = Number(amount);
    if (!fromId || !toId || fromId === toId || !numericAmount || numericAmount <= 0) {
      setResult({ ok: false, message: "Vyberte dva různé vouchery a zadejte platnou částku." });
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setResult({ ok: false, message: "Nejste přihlášeni." });
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/vouchers/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fromVoucherId: fromId,
        toVoucherId: toId,
        amount: numericAmount,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (json.ok) {
      setResult({ ok: true, message: "Přesun byl dokončen." });
      setAmount("");
      loadVouchers();
    } else {
      setResult({ ok: false, message: json.error ?? "Přesun se nezdařil." });
    }
  }

  const fresh = isSessionFresh(session?.user.last_sign_in_at);

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
          <h1 className="font-display text-xl font-bold tracking-tight">Přesun prostředků</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/app/vouchers/transfer")}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : vouchers === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám vouchery…</p>
        ) : vouchers.length < 2 ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Potřebujete aspoň dva vouchery k přesunu.
          </div>
        ) : !fresh ? (
          <div className="flex flex-col items-center gap-3 rounded-sm border border-line-strong p-6 text-center">
            <p className="text-sm text-ink-dim">
              🔒 Pro dokončení přesunu se prosím znovu ověřte — jde o citlivou akci.
            </p>
            {reauthSent ? (
              <p className="text-[11.5px] text-teal">
                Odesláno. Zkontrolujte e-mail a klikněte na odkaz — stránka se pak sama odemkne.
              </p>
            ) : (
              <Button onClick={handleResendMagicLink} className="max-w-xs">
                {reauthSending ? "Odesílám…" : "Poslat nový přihlašovací odkaz"}
              </Button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label className="text-[11.5px] text-ink-faint">Z voucheru</label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
            >
              <option value="">Vyberte voucher</option>
              {vouchers.map((v) => (
                <option key={v.id} value={v.id} disabled={v.id === toId}>
                  {v.title} — {formatCurrency(v.balance, v.currency)}
                </option>
              ))}
            </select>

            <div className="my-1 text-center text-base text-teal">↓</div>

            <label className="text-[11.5px] text-ink-faint">Do voucheru</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
            >
              <option value="">Vyberte voucher</option>
              {vouchers.map((v) => (
                <option key={v.id} value={v.id} disabled={v.id === fromId}>
                  {v.title} — {formatCurrency(v.balance, v.currency)}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              placeholder="Částka"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-3 rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-center text-sm text-ink"
            />

            <Button type="submit" className="mt-3">
              {submitting ? "Přesouvám…" : "Potvrdit přesun"}
            </Button>

            {result && (
              <p className={`text-center text-[11.5px] ${result.ok ? "text-positive" : "text-danger"}`}>
                {result.message}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
