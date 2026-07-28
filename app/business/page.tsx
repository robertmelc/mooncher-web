"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { StatCard } from "@/components/StatCard";
import { BusinessShell } from "@/components/BusinessShell";
import { stripeConnectStatusLabel } from "@/lib/clients";
import { formatCurrency } from "@/lib/format";

type ClientOperator = {
  role: string;
  client: {
    name: string;
    stripe_connect_status: string;
  };
};

type DashboardStats = {
  activeProgramCount: number;
  volume30d: number;
  currency: string;
  activeVoucherCount: number;
};

export default function BusinessPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [operator, setOperator] = useState<ClientOperator | null | undefined>(undefined);
  const [dashboard, setDashboard] = useState<DashboardStats | null | undefined>(undefined);
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
      // Dočasně přes Route Handler (service role) — viz lib/business-auth.ts.
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

  useEffect(() => {
    if (!session || !operator || operator.client.stripe_connect_status !== "active") return;

    async function loadDashboard() {
      const res = await fetch("/api/business/dashboard", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Načtení dashboardu se nezdařilo.");
        return;
      }

      setDashboard({
        activeProgramCount: json.activeProgramCount,
        volume30d: json.volume30d,
        currency: json.currency,
        activeVoucherCount: json.activeVoucherCount,
      });
    }

    loadDashboard();
  }, [session, operator]);

  const isDashboard = operator && operator.client.stripe_connect_status === "active";

  if (isDashboard) {
    return (
      <BusinessShell title="Přehled">
        {dashboard === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám přehled…</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <StatCard label="Aktivní programy" value={String(dashboard!.activeProgramCount)} />
              <StatCard
                label="Objem za 30 dní"
                value={formatCurrency(dashboard!.volume30d, dashboard!.currency)}
                highlight
              />
              <StatCard label="Aktivní vouchery" value={String(dashboard!.activeVoucherCount)} />
            </div>

            <div
              className="rounded-sm p-4"
              style={{
                border: "1px solid rgba(255,255,255,.12)",
                background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
                backdropFilter: "blur(10px)",
              }}
            >
              <div className="mb-1.5 text-[13px] font-semibold">
                Vyčerpání limitu LNE (1 mil. EUR / 12 měs.)
              </div>
              <p className="text-[11.5px] text-ink-faint">
                Zatím nesledováno — doplní se s denním výpočtem objemu (Edge Function, B1 §6).
              </p>
            </div>
          </>
        )}
      </BusinessShell>
    );
  }

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
