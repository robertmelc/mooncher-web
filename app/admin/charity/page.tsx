"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { formatCurrency } from "@/lib/format";

type Claim = {
  id: string;
  winning_ticket_id: string;
  full_name: string;
  bank_account: string;
  phone: string;
  status: string;
  submitted_at: string;
};

type Ticket = {
  id: string;
  listNumber: string;
  targetPhone: string;
  resultNumber: string;
  place: number | null;
  prizeAmount: number;
  currency: string;
  claimDeadline: string;
  clientName: string;
  createdAt: string;
  status: "voided" | "claimed" | "expired" | "pending";
  claims: Claim[];
};

const STATUS_LABEL: Record<Ticket["status"], string> = {
  pending: "Čeká",
  claimed: "Uplatněno",
  expired: "Propadlo",
  voided: "Zneplatněno",
};

export default function AdminCharityPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
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

  async function loadTickets(accessToken: string) {
    const res = await fetch("/api/admin/charity/tickets", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();

    if (!res.ok) {
      if (res.status === 403) {
        setTickets(null);
      } else {
        setError(json.error ?? "Načtení se nezdařilo.");
      }
      return;
    }

    setTickets(json.tickets);
  }

  useEffect(() => {
    if (!session) return;
    loadTickets(session.access_token);
  }, [session]);

  async function handleSendLink(ticketId: string) {
    if (!session) return;
    setBusyId(ticketId);
    await fetch(`/api/admin/charity/tickets/${ticketId}/send-link`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setBusyId(null);
  }

  async function handleClaimAction(claimId: string, action: "paid" | "rejected") {
    if (!session) return;
    let reason: string | undefined;
    if (action === "rejected") {
      reason = window.prompt("Důvod zamítnutí:") ?? undefined;
      if (reason === undefined) return;
    }
    setBusyId(claimId);
    await fetch(`/api/admin/charity/claims/${claimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, reason }),
    });
    setBusyId(null);
    loadTickets(session.access_token);
  }

  async function handleVoid(ticketId: string) {
    if (!session) return;
    const reason = window.prompt("Důvod zneplatnění listu:");
    if (!reason) return;
    setBusyId(ticketId);
    await fetch(`/api/admin/charity/tickets/${ticketId}/void`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ reason }),
    });
    setBusyId(null);
    loadTickets(session.access_token);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Výherní listy</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/charity")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Výherní listy">
      {authLoading || tickets === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : tickets === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">Zatím žádné výherní listy — vydejte je z Losování.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((t) => {
            const activeClaim = t.claims.find((c) => c.status !== "rejected") ?? null;
            return (
              <div key={t.id} className="flex flex-col gap-2 rounded-sm border border-line-strong p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12.5px] font-semibold text-ink">{t.listNumber}</span>
                  <span className="badge">{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="text-[11.5px] text-ink-dim">
                  {t.clientName} · los {t.resultNumber}
                  {t.place ? ` · ${t.place}. místo` : ""} · {formatCurrency(t.prizeAmount, t.currency)}
                </div>
                <div className="text-[10.5px] text-ink-faint">
                  Telefon {t.targetPhone} · lhůta do {new Date(t.claimDeadline).toLocaleString("cs-CZ")}
                </div>

                {activeClaim && (
                  <div className="mt-1 rounded-sm bg-panel2 p-2.5 text-[11.5px]">
                    <div className="text-ink">
                      {activeClaim.full_name} · {activeClaim.bank_account} · {activeClaim.phone}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="badge gray">
                        {activeClaim.status === "paid" ? "Vyplaceno" : "Čeká na výplatu"}
                      </span>
                      {activeClaim.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleClaimAction(activeClaim.id, "paid")}
                            disabled={busyId === activeClaim.id}
                            className="rounded-sm bg-teal-glow px-2.5 py-1 text-[11px] font-semibold text-teal"
                          >
                            Označit vyplaceno
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClaimAction(activeClaim.id, "rejected")}
                            disabled={busyId === activeClaim.id}
                            className="rounded-sm border border-danger-soft bg-danger-soft px-2.5 py-1 text-[11px] text-danger"
                          >
                            Zamítnout
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendLink(t.id)}
                    disabled={busyId === t.id || t.status === "voided"}
                    className="text-[11px] text-teal underline disabled:opacity-40"
                  >
                    Poslat odkaz SMS
                  </button>
                  {t.status !== "voided" && (
                    <button
                      type="button"
                      onClick={() => handleVoid(t.id)}
                      disabled={busyId === t.id}
                      className="text-[11px] text-danger underline"
                    >
                      Zneplatnit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
