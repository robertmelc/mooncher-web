"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { ReferralTree, type ReferralTreeRow } from "@/components/ReferralTree";

type Client = { id: string; name: string };

export default function AdminReferralsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [clients, setClients] = useState<Client[] | null | undefined>(undefined);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<ReferralTreeRow[] | null | undefined>(undefined);
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

    async function loadClients() {
      const res = await fetch("/api/admin/clients", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      setClients(res.ok ? json.clients.map((c: Client) => ({ id: c.id, name: c.name })) : null);
    }

    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session || !clientId) {
      setRows(undefined);
      return;
    }

    async function loadTree() {
      setRows(undefined);
      setError(null);
      const res = await fetch(`/api/admin/referrals/tree?clientId=${clientId}`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Načtení se nezdařilo.");
        setRows(null);
        return;
      }
      setRows(json.rows);
    }

    loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, clientId]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Síť</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/referrals")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Síť">
      {authLoading || clients === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : clients === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] text-ink-faint">Klient</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
            >
              <option value="">Vyberte klienta</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {!clientId ? null : rows === undefined ? (
            <p className="font-mono text-sm text-ink-dim">Načítám strom…</p>
          ) : error ? (
            <p className="font-mono text-sm text-danger">{error}</p>
          ) : (
            <ReferralTree rows={rows ?? []} />
          )}
        </div>
      )}
    </AdminShell>
  );
}
