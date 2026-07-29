"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { StatCard } from "@/components/StatCard";
import { CashflowChart } from "@/components/CashflowChart";
import { formatCurrency } from "@/lib/format";

type CashflowData = {
  inflow: number;
  outflow: number;
  platformFee: number;
  daily: { day: string; inflow: number; outflow: number }[];
};

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<CashflowData | null | undefined>(undefined);
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

    async function loadCashflow() {
      const res = await fetch("/api/admin/cashflow", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setData(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setData(json);
    }

    loadCashflow();
  }, [session]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Cashflow</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Cashflow">
      {authLoading || data === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : data === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <StatCard label="Inflow (30 dní)" value={formatCurrency(data.inflow, "CZK")} highlight />
            <StatCard label="Outflow (30 dní)" value={formatCurrency(data.outflow, "CZK")} />
            <StatCard label="Platform fee příjem" value={formatCurrency(data.platformFee, "CZK")} highlight />
          </div>

          <div
            className="rounded-sm p-4"
            style={{
              border: "1px solid rgba(255,255,255,.12)",
              background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="mb-3 text-[11.5px] text-ink-faint">Inflow / outflow v čase</div>
            <CashflowChart data={data.daily} />
          </div>
        </>
      )}
    </AdminShell>
  );
}
