"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { complianceLabel, complianceBadgeVariant } from "@/lib/compliance";

type ClientCompliance = {
  id: string;
  name: string;
  thresholdPct: number | null;
};

export default function AdminCompliancePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [clients, setClients] = useState<ClientCompliance[] | null | undefined>(undefined);
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

    async function loadCompliance() {
      const res = await fetch("/api/admin/compliance", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setClients(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setClients(json.clients);
    }

    loadCompliance();
  }, [session]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Compliance</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/admin/compliance")}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Compliance">
      {authLoading || clients === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : clients === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[11.5px] text-ink-faint">
            Vyčerpání limitu LNE (1 mil. EUR / 12 měsíců) na klienta. Zvýrazněno nad 80 %.
          </p>
          {clients.length === 0 ? (
            <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
              Zatím žádní klienti.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {clients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between gap-4 rounded-sm p-4"
                  style={{
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <span className="text-[13.5px] font-semibold">{client.name}</span>
                  <span className={`badge ${complianceBadgeVariant(client.thresholdPct)}`}>
                    {complianceLabel(client.thresholdPct)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
