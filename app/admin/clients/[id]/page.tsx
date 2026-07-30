"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { clientStatusLabel, clientStatusBadgeVariant, stripeConnectStatusLabel } from "@/lib/clients";
import { programStatusLabel } from "@/lib/programs";
import { transactionTypeLabel } from "@/lib/transactions";
import { formatCurrency } from "@/lib/format";

type ClientDetail = {
  client: {
    id: string;
    name: string;
    status: string;
    stripe_connect_status: string;
    contact_email: string;
  };
  programs: { id: string; name: string; status: string; voucher_type: string; currency: string }[];
  transactions: {
    date: string;
    programName: string;
    type: string;
    amount: number;
    currency: string;
    positive: boolean;
  }[];
  auditLog: { actorType: string; action: string; targetTable: string; createdAt: string }[];
};

export default function AdminClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [detail, setDetail] = useState<ClientDetail | null | undefined>(undefined);
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

    async function loadDetail() {
      const res = await fetch(`/api/admin/clients/${params.id}`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          setDetail(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setDetail(json);
    }

    loadDetail();
  }, [session, params.id]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Detail klienta</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/admin/clients/${params.id}`)}`}
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
    <AdminShell title={detail?.client.name ?? "Detail klienta"}>
      {authLoading || detail === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : detail === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Klient nenalezen nebo nemáte oprávnění.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex gap-2">
            <span className={`badge ${clientStatusBadgeVariant(detail.client.status)}`}>
              {clientStatusLabel(detail.client.status)}
            </span>
            <span className="badge gray">{stripeConnectStatusLabel(detail.client.stripe_connect_status)}</span>
          </div>
          <p className="text-[12.5px] text-ink-faint">{detail.client.contact_email}</p>

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[14px] font-bold">Programy ({detail.programs.length})</h2>
            {detail.programs.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Zatím žádné programy.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.programs.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-sm border border-line px-3.5 py-2.5"
                  >
                    <span className="text-[12.5px] font-semibold">{p.name}</span>
                    <span className="badge gray">{programStatusLabel(p.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[14px] font-bold">Transakce (posledních 30 dní)</h2>
            {detail.transactions.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Zatím žádné transakce za posledních 30 dní.</p>
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
                    {detail.transactions.map((t, i) => (
                      <tr key={i} className="border-b border-line text-ink-dim">
                        <td className="py-2 pr-3">{new Date(t.date).toLocaleDateString("cs-CZ")}</td>
                        <td className="py-2 pr-3">{t.programName}</td>
                        <td className="py-2 pr-3">{transactionTypeLabel(t.type)}</td>
                        <td
                          className="py-2 pr-3 font-mono font-semibold"
                          style={{ color: t.positive ? "var(--positive)" : "var(--danger)" }}
                        >
                          {t.positive ? "+" : "−"} {formatCurrency(t.amount, t.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[14px] font-bold">Audit log</h2>
            {detail.auditLog.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Zatím žádné záznamy.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {detail.auditLog.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-[11.5px]">
                    <span className="font-mono text-ink-dim">{a.action}</span>
                    <span className="text-ink-faint">
                      {new Date(a.createdAt).toLocaleString("cs-CZ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
