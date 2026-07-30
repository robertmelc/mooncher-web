"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/Button";
import { clientStatusLabel, clientStatusBadgeVariant, stripeConnectStatusLabel } from "@/lib/clients";

type Client = {
  id: string;
  name: string;
  status: string;
  stripe_connect_status: string;
};

export default function AdminClientsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [clients, setClients] = useState<Client[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  async function loadClients(token: string) {
    const res = await fetch("/api/admin/clients", {
      headers: { Authorization: `Bearer ${token}` },
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

  useEffect(() => {
    if (!session) return;
    loadClients(session.access_token);
  }, [session]);

  async function handleAction(clientId: string, action: "suspend" | "reactivate") {
    if (!session) return;
    setActionError(null);
    setPendingId(clientId);

    const res = await fetch(`/api/admin/clients/${clientId}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();

    if (!res.ok) {
      setActionError(json.error ?? "Akce se nezdařila.");
      setPendingId(null);
      return;
    }

    await loadClients(session.access_token);
    setPendingId(null);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Klienti</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/clients")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Klienti">
      {authLoading || clients === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : clients === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Zatím žádní klienti.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {actionError && <p className="font-mono text-sm text-danger">{actionError}</p>}
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
              <div className="flex flex-col gap-1.5">
                <Link href={`/admin/clients/${client.id}`} className="text-[13.5px] font-semibold hover:underline">
                  {client.name}
                </Link>
                <div className="flex gap-2">
                  <span className={`badge ${clientStatusBadgeVariant(client.status)}`}>
                    {clientStatusLabel(client.status)}
                  </span>
                  <span className="badge gray">{stripeConnectStatusLabel(client.stripe_connect_status)}</span>
                </div>
              </div>

              {client.status === "active" && (
                <Button
                  variant="ghost"
                  className="max-w-[140px]"
                  disabled={pendingId === client.id}
                  onClick={() => handleAction(client.id, "suspend")}
                >
                  {pendingId === client.id ? "…" : "Pozastavit"}
                </Button>
              )}
              {client.status === "suspended" && (
                <Button
                  variant="ghost"
                  className="max-w-[140px]"
                  disabled={pendingId === client.id}
                  onClick={() => handleAction(client.id, "reactivate")}
                >
                  {pendingId === client.id ? "…" : "Reaktivovat"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
