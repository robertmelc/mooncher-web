"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { stripeConnectStatusLabel } from "@/lib/clients";

type ClientOperator = {
  role: string;
  client: {
    name: string;
    stripe_connect_status: string;
  };
};

export default function BusinessOnboardingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [operator, setOperator] = useState<ClientOperator | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(null);

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

    async function loadOperator() {
      // Dočasně přes Route Handler (service role) — RLS na vpc_client_users
      // je zablokovaná kruhovou závislostí na chybějícím JWT claimu, viz
      // komentář v app/api/business/operator/route.ts.
      const res = await fetch("/api/business/operator", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setOperator(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setOperator({ role: json.role, client: json.client });
    }

    loadOperator();
  }, [session]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <header className="border-b border-line pb-4">
          <h1 className="font-display text-lg font-bold tracking-tight">Nastavení plateb</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/business")}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : operator === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám…</p>
        ) : operator === null ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Tento účet není napojený na žádného klienta.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 pt-8 text-center">
            <MoonMark size={52} />
            <h2 className="font-display text-xl font-bold tracking-tight">Peníze jdou vždy vám</h2>
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-dim">
              Mooncher nikdy nedrží hodnotu vašich vouchrů. Propojte svůj platební účet a objem
              transakcí bude sedět přímo u vás ({operator.client.name}).
            </p>
            <span className="badge">{stripeConnectStatusLabel(operator.client.stripe_connect_status)}</span>
            <button
              type="button"
              onClick={() => setPlaceholderMessage("K dispozici brzy.")}
              className="w-full max-w-xs rounded-sm bg-teal px-4 py-3 text-center text-[13.5px] font-semibold text-[#04211B]"
            >
              Propojit platební účet
            </button>
            {placeholderMessage && <p className="text-[11.5px] text-teal">{placeholderMessage}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
