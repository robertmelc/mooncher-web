"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { formatCurrency } from "@/lib/format";

type Settlement = {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  settled_at: string | null;
  settled_by_email: string | null;
  creditor: { name: string } | null;
  debtor: { name: string } | null;
  voucher: { code: string } | null;
};

export default function AdminSettlementsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [settlements, setSettlements] = useState<Settlement[] | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function loadSettlements(accessToken: string) {
    const res = await fetch("/api/admin/settlements", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (res.ok) {
      setSettlements(json.settlements);
    } else {
      setSettlements(null);
    }
  }

  useEffect(() => {
    if (!session) return;
    loadSettlements(session.access_token);
  }, [session]);

  async function handleMarkSettled(id: string) {
    if (!session) return;
    setBusyId(id);
    await fetch(`/api/admin/settlements/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setBusyId(null);
    loadSettlements(session.access_token);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Dluhy mezi firmami</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/settlements")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Dluhy mezi firmami">
      {authLoading || settlements === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : settlements === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : settlements.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">Zatím žádné dluhy mezi firmami.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {settlements.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-sm border border-line-strong px-3.5 py-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-ink">
                  <b>{s.debtor?.name}</b> dluží <b>{s.creditor?.name}</b>
                </span>
                <span className="text-[11px] text-ink-faint">
                  {formatCurrency(s.amount, "CZK")} · karta {s.voucher?.code} · {new Date(s.created_at).toLocaleString("cs-CZ")}
                </span>
                {s.status === "settled" && (
                  <span className="text-[11px] text-positive">
                    Vyrovnáno {s.settled_at ? new Date(s.settled_at).toLocaleDateString("cs-CZ") : ""} ({s.settled_by_email})
                  </span>
                )}
              </div>
              {s.status === "outstanding" ? (
                <button
                  type="button"
                  onClick={() => handleMarkSettled(s.id)}
                  disabled={busyId === s.id}
                  className="flex-shrink-0 rounded-sm bg-teal-glow px-2.5 py-1.5 text-[11.5px] font-semibold text-teal"
                >
                  Označit vyrovnáno
                </button>
              ) : (
                <span className="badge gray flex-shrink-0">Vyrovnáno</span>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
