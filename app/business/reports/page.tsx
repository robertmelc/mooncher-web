"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { formatCurrency } from "@/lib/format";
import { transactionTypeLabel } from "@/lib/transactions";
import { rowsToCsv, downloadCsv } from "@/lib/csv";

type ReportRow = {
  date: string;
  programName: string;
  type: string;
  amount: number;
  currency: string;
  positive: boolean;
};

export default function BusinessReportsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rows, setRows] = useState<ReportRow[] | null | undefined>(undefined);
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

    async function loadReports() {
      const res = await fetch("/api/business/reports", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setRows(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setRows(json.rows);
    }

    loadReports();
  }, [session]);

  function handleExport() {
    if (!rows || rows.length === 0) return;

    const csv = rowsToCsv(
      ["Datum", "Program", "Typ", "Částka", "Měna"],
      rows.map((r) => [
        new Date(r.date).toLocaleDateString("cs-CZ"),
        r.programName,
        transactionTypeLabel(r.type),
        `${r.positive ? "+" : "-"}${r.amount}`,
        r.currency,
      ])
    );

    downloadCsv(`mooncher-transakce-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Reporty</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/business/reports")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <BusinessShell title="Reporty">
      {authLoading || rows === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : rows === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="font-display text-base font-bold">Transakce (posledních 30 dní)</span>
            <button
              type="button"
              onClick={handleExport}
              disabled={rows.length === 0}
              className="rounded-sm border border-line-strong bg-panel2 px-3.5 py-2 text-[12.5px] font-semibold text-ink disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
              Zatím žádné transakce za posledních 30 dní.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="py-2 pr-3 font-mono font-semibold">Datum</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Program</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Typ</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Částka</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-line text-ink-dim">
                      <td className="py-2 pr-3">{new Date(r.date).toLocaleDateString("cs-CZ")}</td>
                      <td className="py-2 pr-3">{r.programName}</td>
                      <td className="py-2 pr-3">{transactionTypeLabel(r.type)}</td>
                      <td
                        className="py-2 pr-3 font-mono font-semibold"
                        style={{ color: r.positive ? "var(--positive)" : "var(--danger)" }}
                      >
                        {r.positive ? "+" : "−"} {formatCurrency(r.amount, r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </BusinessShell>
  );
}
