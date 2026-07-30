"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { VoucherCard } from "@/components/VoucherCard";
import { VoucherSlider } from "@/components/VoucherSlider";
import { Button } from "@/components/Button";
import { formatCurrency } from "@/lib/format";
import { voucherStatusLabel, voucherTypeLabel } from "@/lib/vouchers";
import { isSessionFresh } from "@/lib/reauth";

type VoucherWithProgram = {
  id: string;
  code: string;
  status: string;
  account_id: string;
  voucher_program: {
    name: string;
    voucher_type: string;
    currency: string;
    max_load_amount: number | null;
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
  maxAmount: number | null;
};

export default function VoucherGiftPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [voucher, setVoucher] = useState<VoucherCardData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(500);
  const [submitting, setSubmitting] = useState(false);
  const [reauthSending, setReauthSending] = useState(false);
  const [reauthSent, setReauthSent] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; voucherId?: string } | null>(null);

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
             name, voucher_type, currency, max_load_amount,
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

      const { data: ledgerEntries } = await supabase
        .from("vpc_ledger_entries")
        .select("balance_after, created_at")
        .eq("account_id", row.account_id)
        .order("created_at", { ascending: false })
        .limit(1);

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
        maxAmount: program.max_load_amount,
      });
    }

    loadVoucher();
  }, [session, params.id]);

  async function handleResendMagicLink() {
    if (!session?.user.email) return;
    setReauthSending(true);
    await supabase.auth.signInWithOtp({
      email: session.user.email,
      options: { emailRedirectTo: `${window.location.origin}/app/vouchers/${params.id}/gift` },
    });
    setReauthSending(false);
    setReauthSent(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    if (!recipientPhone.trim() || amount <= 0) {
      setResult({ ok: false, message: "Zadejte telefon příjemce a platnou částku." });
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setResult({ ok: false, message: "Nejste přihlášeni." });
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/vouchers/gift", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        voucherId: params.id,
        recipientPhone,
        recipientName: recipientName || undefined,
        message: message || undefined,
        amount,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (json.ok) {
      setResult({ ok: true, message: "Dar byl vytvořen.", voucherId: json.voucherId });
    } else {
      setResult({ ok: false, message: json.error ?? "Darování se nezdařilo." });
    }
  }

  const fresh = isSessionFresh(session?.user.last_sign_in_at);
  const activationUrl =
    result?.ok && result.voucherId && typeof window !== "undefined"
      ? `${window.location.origin}/app/activate/${result.voucherId}`
      : null;

  async function handleCopyLink() {
    if (!activationUrl) return;
    await navigator.clipboard.writeText(activationUrl);
  }

  async function handleShareLink() {
    if (!activationUrl) return;
    if (navigator.share) {
      await navigator.share({ title: "Dárkový voucher", url: activationUrl });
    }
  }

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
          <h1 className="font-display text-xl font-bold tracking-tight">Darovat voucher</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/app/vouchers/${params.id}/gift`)}`}
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
        ) : result?.ok ? (
          <div className="flex flex-col items-center gap-4 rounded-sm border border-line-strong p-6 text-center">
            <p className="text-sm text-ink">
              Dar je vytvořený. Automatické doručení SMS zatím nemáme — přepošlete odkaz příjemci sami.
            </p>
            <p className="break-all rounded-sm bg-panel2 px-3 py-2 font-mono text-[11px] text-ink-dim">
              {activationUrl}
            </p>
            <div className="flex w-full gap-2">
              <Button variant="ghost" className="flex-1" onClick={handleCopyLink}>
                Kopírovat odkaz
              </Button>
              <Button className="flex-1" onClick={handleShareLink}>
                Sdílet
              </Button>
            </div>
            <Link href={`/app/vouchers/${params.id}`} className="text-[11.5px] text-teal underline">
              Zpět na voucher
            </Link>
          </div>
        ) : !fresh ? (
          <div className="flex flex-col items-center gap-3 rounded-sm border border-line-strong p-6 text-center">
            <p className="text-sm text-ink-dim">
              🔒 Pro dokončení darování se prosím znovu ověřte — jde o citlivou akci.
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
          <>
            <VoucherCard {...voucher} />

            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <label className="mt-2 text-[11.5px] text-ink-faint">Telefon příjemce</label>
              <input
                type="tel"
                placeholder="+420 xxx xxx xxx"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
              />

              <label className="mt-2 text-[11.5px] text-ink-faint">Jméno příjemce (nepovinné)</label>
              <input
                type="text"
                placeholder="Jana Nováková"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
              />

              <label className="mt-2 text-[11.5px] text-ink-faint">Vzkaz (nepovinné)</label>
              <textarea
                placeholder="Ať se ti líbí…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
              />

              <div className="mt-2 text-center text-[11.5px] text-ink-faint">Částka daru</div>
              <div className="text-center font-display text-3xl font-extrabold">
                {formatCurrency(amount, voucher.currency)}
              </div>
              <VoucherSlider
                min={0}
                max={voucher.maxAmount ?? 10000}
                step={100}
                value={amount}
                onChange={setAmount}
              />
              <div className="-mt-2 flex justify-between text-[11.5px] text-ink-faint">
                <span>{formatCurrency(0, voucher.currency)}</span>
                <span>{formatCurrency(voucher.maxAmount ?? 10000, voucher.currency)}</span>
              </div>

              <Button type="submit" className="mt-3" disabled={submitting}>
                {submitting ? "Odesílám…" : "Darovat"}
              </Button>

              {result && !result.ok && (
                <p className="text-center text-[11.5px] text-danger">{result.message}</p>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
