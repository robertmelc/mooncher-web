"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { Button } from "@/components/Button";

type ReferralPreview = { clientName: string; referrerName: string | null };

export default function JoinReferralPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ReferralPreview | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; voucherId?: string | null } | null>(null);

  useEffect(() => {
    async function loadPreview() {
      const res = await fetch(`/api/referral/${params.code}`);
      const json = await res.json();
      setPreview(json.ok ? json.referral : null);
    }
    loadPreview();
  }, [params.code]);

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

  async function handleConfirm() {
    if (!session) return;
    setSubmitting(true);
    setResult(null);

    const res = await fetch(`/api/referral/${params.code}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    setSubmitting(false);
    setResult({
      ok: json.ok,
      message: json.ok ? (json.voucherId ? "Propojeno — váš voucher je připravený." : "Propojeno.") : json.error,
      voucherId: json.voucherId,
    });
  }

  function handleLoginRedirect() {
    router.push(`/app/login?next=${encodeURIComponent(`/app/join/${params.code}`)}`);
  }

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <MoonMark size={56} />

        {preview === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám pozvánku…</p>
        ) : preview === null ? (
          <div className="w-full rounded-sm border border-dashed border-line-strong p-6 text-sm text-ink-faint">
            Pozvánka nenalezena nebo už neplatí.
          </div>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold tracking-tight">Pozvánka do {preview.clientName}</h1>
            {preview.referrerName && (
              <p className="text-[13px] text-ink-dim">od {preview.referrerName}</p>
            )}

            {result?.ok ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <p className="text-sm text-positive">{result.message}</p>
                <Button onClick={() => router.push(result.voucherId ? `/app/vouchers/${result.voucherId}` : "/app")}>
                  Pokračovat do appky
                </Button>
              </div>
            ) : authLoading ? (
              <p className="mt-4 font-mono text-sm text-ink-dim">Načítám…</p>
            ) : !session ? (
              <div className="mt-4 flex w-full flex-col gap-3">
                <p className="text-[13px] text-ink-dim">Pro propojení se musíte přihlásit.</p>
                <Button onClick={handleLoginRedirect}>Přihlásit se</Button>
              </div>
            ) : (
              <div className="mt-4 flex w-full flex-col gap-3">
                <p className="text-[11.5px] text-ink-faint">Přihlášeno jako {session.user.email}</p>
                <Button onClick={handleConfirm} disabled={submitting}>
                  {submitting ? "Propojuji…" : "Potvrdit propojení"}
                </Button>
                {result && !result.ok && <p className="text-[11.5px] text-danger">{result.message}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
