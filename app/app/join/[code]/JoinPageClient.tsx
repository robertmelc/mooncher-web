"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { Button } from "@/components/Button";
import { JoinSuccessScreen } from "@/components/JoinSuccessScreen";

type ReferralPreview = { clientName: string; referrerName: string | null };

function JoinReferralForm({ params }: { params: { code: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Jméno/telefon/invite ID appka protahuje přes magic-link odkaz stejně
  // jako dnešní `next` na /app/login — přežije to i otevření e-mailu na
  // jiném zařízení/prohlížeči, na rozdíl od localStorage.
  const nameFromLink = searchParams.get("name") ?? "";
  const phoneFromLink = searchParams.get("phone") ?? "";
  const inviteId = searchParams.get("invite");

  const [preview, setPreview] = useState<ReferralPreview | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; voucherId?: string | null } | null>(null);

  const [name, setName] = useState(nameFromLink);
  const [phone, setPhone] = useState(phoneFromLink);
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

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

  async function handleStartLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !email.trim()) {
      setLoginError("Vyplňte prosím jméno, telefon i e-mail.");
      return;
    }

    setLoginError(null);
    setSendingLink(true);

    const redirectParams = new URLSearchParams({ name: name.trim(), phone: phone.trim() });
    if (inviteId) redirectParams.set("invite", inviteId);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/app/join/${params.code}?${redirectParams.toString()}`,
      },
    });

    setSendingLink(false);

    if (error) {
      setLoginError(error.message);
      return;
    }

    setLinkSent(true);
  }

  async function handleConfirm() {
    if (!session) return;
    setSubmitting(true);
    setResult(null);

    const res = await fetch(`/api/referral/${params.code}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameFromLink || undefined,
        phone: phoneFromLink || undefined,
        inviteId: inviteId || undefined,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    setResult({
      ok: json.ok,
      message: json.ok ? (json.voucherId ? "Propojeno — váš voucher je připravený." : "Propojeno.") : json.error,
      voucherId: json.voucherId,
    });
  }

  if (result?.ok) {
    return (
      <JoinSuccessScreen
        onContinue={() => router.push(result.voucherId ? `/app/vouchers/${result.voucherId}` : "/app")}
      />
    );
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

            {authLoading ? (
              <p className="mt-4 font-mono text-sm text-ink-dim">Načítám…</p>
            ) : !session ? (
              linkSent ? (
                <p className="mt-4 text-[13px] text-ink-dim">
                  Zkontrolujte e-mail a klikněte na odkaz pro přihlášení.
                </p>
              ) : (
                <form onSubmit={handleStartLogin} className="mt-4 flex w-full flex-col gap-2.5 text-left">
                  <label className="text-[11.5px] text-ink-faint">Jméno</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jan Novák"
                    className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
                  />

                  <label className="mt-1 text-[11.5px] text-ink-faint">Telefon</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+420 604 251 244"
                    className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
                  />

                  <label className="mt-1 text-[11.5px] text-ink-faint">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vas@email.cz"
                    className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-sm text-ink"
                  />

                  <Button type="submit" className="mt-2" disabled={sendingLink}>
                    {sendingLink ? "Odesílám…" : "Poslat přihlašovací odkaz"}
                  </Button>
                  {loginError && <p className="text-[11.5px] text-danger">{loginError}</p>}
                </form>
              )
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

export function JoinPageClient({ params }: { params: { code: string } }) {
  return (
    <Suspense fallback={null}>
      <JoinReferralForm params={params} />
    </Suspense>
  );
}
