"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/Button";

type DrawRow = {
  id: string;
  range_min: number;
  range_max: number;
  seed: string;
  seed_source: string;
  result_hash: string;
  result_number: number;
  prize_description: string;
  created_by_email: string;
  created_at: string;
};

type Client = { id: string; name: string };

export default function AdminDrawPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [draws, setDraws] = useState<DrawRow[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [rangeMin, setRangeMin] = useState("1");
  const [rangeMax, setRangeMax] = useState("100");
  const [seed, setSeed] = useState("");
  const [prizeDescription, setPrizeDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastDraw, setLastDraw] = useState<DrawRow | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [issuingDrawId, setIssuingDrawId] = useState<string | null>(null);
  const [ticketClientId, setTicketClientId] = useState("");
  const [ticketPhone, setTicketPhone] = useState("");
  const [ticketPlace, setTicketPlace] = useState("");
  const [ticketAmount, setTicketAmount] = useState("");
  const [ticketAmountIsNet, setTicketAmountIsNet] = useState("");
  const [ticketTaxWithheld, setTicketTaxWithheld] = useState("");
  const [ticketDeadline, setTicketDeadline] = useState("");
  const [issuingTicket, setIssuingTicket] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketResult, setTicketResult] = useState<{ drawId: string; listNumber: string } | null>(null);

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

  async function loadDraws(accessToken: string) {
    const res = await fetch("/api/admin/draws", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();

    if (!res.ok) {
      if (res.status === 403) {
        setDraws(null);
      } else {
        setError(json.error ?? "Načtení se nezdařilo.");
      }
      return;
    }

    setDraws(json.draws);
  }

  useEffect(() => {
    if (!session) return;
    loadDraws(session.access_token);
  }, [session]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/admin/clients", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok !== false) setClients((json.clients ?? []).map((c: Client) => ({ id: c.id, name: c.name })));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  function startIssueTicket(drawId: string) {
    setIssuingDrawId(drawId);
    setTicketClientId("");
    setTicketPhone("");
    setTicketPlace("");
    setTicketAmount("");
    setTicketAmountIsNet("");
    setTicketTaxWithheld("");
    setTicketDeadline("");
    setTicketError(null);
  }

  async function handleIssueTicket(drawId: string) {
    if (!session) return;

    if (!ticketClientId || !ticketPhone.trim() || !ticketAmount || !ticketAmountIsNet || !ticketDeadline) {
      setTicketError("Vyplňte klienta, telefon, částku, typ částky i lhůtu.");
      return;
    }

    setIssuingTicket(true);
    setTicketError(null);

    const res = await fetch(`/api/admin/draws/${drawId}/winning-tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        clientId: ticketClientId,
        targetPhone: ticketPhone.trim(),
        place: ticketPlace ? Number(ticketPlace) : undefined,
        prizeAmount: Number(ticketAmount),
        amountIsNet: ticketAmountIsNet === "net",
        taxWithheld: ticketTaxWithheld ? Number(ticketTaxWithheld) : undefined,
        claimDeadline: new Date(ticketDeadline).toISOString(),
      }),
    });
    const json = await res.json();
    setIssuingTicket(false);

    if (!res.ok) {
      setTicketError(json.error ?? "Vydání se nezdařilo.");
      return;
    }

    setTicketResult({ drawId, listNumber: json.listNumber });
    setIssuingDrawId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;

    setSubmitError(null);
    setSubmitting(true);

    const res = await fetch("/api/admin/draws", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        rangeMin: Number(rangeMin),
        rangeMax: Number(rangeMax),
        seed: seed || undefined,
        prizeDescription,
      }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError(json.error ?? "Losování se nezdařilo.");
      return;
    }

    setLastDraw(json.draw);
    setSeed("");
    setPrizeDescription("");
    loadDraws(session.access_token);
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Losování</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/draw")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Losování">
      {authLoading || draws === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : draws === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <div className="flex gap-2.5">
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-[11.5px] text-ink-faint">Číslo od</label>
                <input
                  type="number"
                  value={rangeMin}
                  onChange={(e) => setRangeMin(e.target.value)}
                  className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-[11.5px] text-ink-faint">Číslo do</label>
                <input
                  type="number"
                  value={rangeMax}
                  onChange={(e) => setRangeMax(e.target.value)}
                  className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>

            <label className="mt-1 text-[11.5px] text-ink-faint">Seed (nepovinné — prázdné = náhodný)</label>
            <input
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="ponechte prázdné pro náhodný seed"
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 font-mono text-sm text-ink"
            />

            <label className="mt-1 text-[11.5px] text-ink-faint">Text výhry</label>
            <textarea
              value={prizeDescription}
              onChange={(e) => setPrizeDescription(e.target.value)}
              rows={2}
              placeholder="např. Víkendový pobyt v lázních"
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
            />

            <Button type="submit" className="mt-2" disabled={submitting}>
              {submitting ? "Losuji…" : "Spustit losování"}
            </Button>
            {submitError && <p className="text-[11.5px] text-danger">{submitError}</p>}
          </form>

          {lastDraw && (
            <div className="rounded-sm border border-teal-glow bg-teal-glow p-4">
              <div className="text-[11.5px] text-ink-faint">Výsledek</div>
              <div className="font-display text-3xl font-extrabold text-teal">{lastDraw.result_number}</div>
              <div className="mt-2 text-[11.5px] text-ink-dim">{lastDraw.prize_description}</div>
              <div className="mt-3 flex flex-col gap-1 font-mono text-[10.5px] text-ink-faint">
                <span>seed: {lastDraw.seed}</span>
                <span>hash: {lastDraw.result_hash}</span>
              </div>
              <p className="mt-2 text-[10.5px] text-ink-faint">
                Ověření: SHA-256(seed:{lastDraw.range_min}:{lastDraw.range_max}) mod (
                {lastDraw.range_max - lastDraw.range_min + 1}) + {lastDraw.range_min} = {lastDraw.result_number}
              </p>
            </div>
          )}

          <div>
            <h2 className="mb-2 font-display text-[14px] font-bold">Historie losování</h2>
            {draws.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Zatím žádné losování.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-faint">
                      <th className="py-2 pr-3 font-mono font-semibold">Čas</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Rozsah</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Výsledek</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Výhra</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Seed</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Hash</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Admin</th>
                      <th className="py-2 pr-3 font-mono font-semibold">Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draws.map((d) => (
                      <Fragment key={d.id}>
                        <tr className="border-b border-line text-ink-dim">
                          <td className="py-2 pr-3 whitespace-nowrap">{new Date(d.created_at).toLocaleString("cs-CZ")}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {d.range_min}–{d.range_max}
                          </td>
                          <td className="py-2 pr-3 font-mono font-semibold text-teal">{d.result_number}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{d.prize_description}</td>
                          <td className="py-2 pr-3 whitespace-nowrap font-mono text-[9.5px] text-ink-faint">
                            {d.seed}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap font-mono text-[9.5px] text-ink-faint">
                            {d.result_hash}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-[10.5px] text-ink-faint">
                            {d.created_by_email}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <Link
                                href={`/admin/issue-voucher?message=${encodeURIComponent(d.prize_description)}`}
                                className="text-[10.5px] text-teal underline"
                              >
                                Vydat výherci
                              </Link>
                              <button
                                type="button"
                                onClick={() => startIssueTicket(d.id)}
                                className="text-left text-[10.5px] text-gold underline"
                                style={{ color: "#E8C27A" }}
                              >
                                Vydat výherní list
                              </button>
                              {ticketResult?.drawId === d.id && (
                                <span className="text-[10.5px] text-positive">Vydáno: {ticketResult.listNumber}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {issuingDrawId === d.id && (
                          <tr className="border-b border-line">
                            <td colSpan={8} className="py-3">
                              <div className="flex flex-col gap-2 rounded-sm border border-line-strong bg-panel2 p-3">
                                <div className="flex gap-2">
                                  <select
                                    value={ticketClientId}
                                    onChange={(e) => setTicketClientId(e.target.value)}
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  >
                                    <option value="">Vyberte klienta</option>
                                    {clients.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="tel"
                                    value={ticketPhone}
                                    onChange={(e) => setTicketPhone(e.target.value)}
                                    placeholder="Telefon výherce"
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  />
                                  <input
                                    type="number"
                                    value={ticketPlace}
                                    onChange={(e) => setTicketPlace(e.target.value)}
                                    placeholder="Pořadí (nepovinné)"
                                    className="w-32 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={ticketAmount}
                                    onChange={(e) => setTicketAmount(e.target.value)}
                                    placeholder="Částka výhry"
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  />
                                  <select
                                    value={ticketAmountIsNet}
                                    onChange={(e) => setTicketAmountIsNet(e.target.value)}
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  >
                                    <option value="">Hrubá, nebo čistá?</option>
                                    <option value="gross">Hrubá (daň se ještě strhne)</option>
                                    <option value="net">Čistá (k výplatě)</option>
                                  </select>
                                  <input
                                    type="number"
                                    value={ticketTaxWithheld}
                                    onChange={(e) => setTicketTaxWithheld(e.target.value)}
                                    placeholder="Sražená daň (nepovinné)"
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="datetime-local"
                                    value={ticketDeadline}
                                    onChange={(e) => setTicketDeadline(e.target.value)}
                                    className="flex-1 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleIssueTicket(d.id)}
                                    disabled={issuingTicket}
                                    className="rounded-sm bg-teal px-4 py-1.5 text-[12.5px] font-semibold text-[#04211B] disabled:opacity-50"
                                  >
                                    {issuingTicket ? "Vydávám…" : "Vydat"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setIssuingDrawId(null)}
                                    className="rounded-sm border border-line-strong px-3 py-1.5 text-[12.5px] text-ink-dim"
                                  >
                                    Zrušit
                                  </button>
                                </div>
                                {ticketError && <p className="text-[11.5px] text-danger">{ticketError}</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
