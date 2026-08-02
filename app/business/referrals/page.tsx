"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { Button } from "@/components/Button";

type Level = { id: string; name: string; threshold: number };

export default function ReferralLevelsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [levels, setLevels] = useState<Level[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editThreshold, setEditThreshold] = useState("");

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

  async function loadLevels(accessToken: string) {
    const res = await fetch("/api/business/referrals/levels", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();

    if (!res.ok) {
      if (res.status === 404) {
        setLevels(null);
      } else {
        setError(json.error ?? "Načtení se nezdařilo.");
      }
      return;
    }

    setLevels(json.levels);
  }

  useEffect(() => {
    if (!session?.access_token) return;
    loadLevels(session.access_token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;

    setFormError(null);
    const numericThreshold = Number(threshold);
    if (!name.trim() || !numericThreshold || numericThreshold <= 0) {
      setFormError("Zadejte název a kladný práh.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/business/referrals/levels", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name: name.trim(), threshold: numericThreshold }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setFormError(json.error ?? "Vytvoření se nezdařilo.");
      return;
    }

    setName("");
    setThreshold("");
    loadLevels(session.access_token);
  }

  function startEdit(level: Level) {
    setEditingId(level.id);
    setEditName(level.name);
    setEditThreshold(String(level.threshold));
  }

  async function handleSaveEdit(id: string) {
    if (!session) return;
    const numericThreshold = Number(editThreshold);
    if (!editName.trim() || !numericThreshold || numericThreshold <= 0) {
      setFormError("Zadejte název a kladný práh.");
      return;
    }

    const res = await fetch(`/api/business/referrals/levels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name: editName.trim(), threshold: numericThreshold }),
    });
    const json = await res.json();

    if (!res.ok) {
      setFormError(json.error ?? "Uložení se nezdařilo.");
      return;
    }

    setEditingId(null);
    loadLevels(session.access_token);
  }

  async function handleDelete(id: string) {
    if (!session) return;
    const res = await fetch(`/api/business/referrals/levels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      loadLevels(session.access_token);
    }
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Úrovně</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/business/referrals")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <BusinessShell title="Úrovně">
      {authLoading || levels === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : levels === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            Úrovně pozvánkového programu — kdo naplní práh počtu přímých pozvání, postoupí na tuhle úroveň.
            Bez omezení počtu úrovní, klidně přidejte další.
          </p>

          <Link href="/business/referrals/tree" className="text-[11.5px] text-teal underline">
            Zobrazit strom pozvání →
          </Link>

          <form onSubmit={handleCreate} className="flex flex-col gap-2.5">
            <div className="flex gap-2.5">
              <div className="flex flex-[2] flex-col gap-1.5">
                <label className="text-[11.5px] text-ink-faint">Název úrovně</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="např. Ambassador"
                  className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-[11.5px] text-ink-faint">Práh (pozvání)</label>
                <input
                  type="number"
                  min={1}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Přidávám…" : "Přidat úroveň"}
            </Button>
            {formError && <p className="text-[11.5px] text-danger">{formError}</p>}
          </form>

          <div>
            <h2 className="mb-2 font-display text-[14px] font-bold">Nastavené úrovně</h2>
            {levels.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">Zatím žádná úroveň — pozvánkový program je vypnutý.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {levels.map((level) => (
                  <div
                    key={level.id}
                    className="flex items-center justify-between gap-3 rounded-sm border border-line-strong px-3.5 py-2.5"
                  >
                    {editingId === level.id ? (
                      <>
                        <div className="flex flex-1 gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="min-w-0 flex-[2] rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-ink"
                          />
                          <input
                            type="number"
                            min={1}
                            value={editThreshold}
                            onChange={(e) => setEditThreshold(e.target.value)}
                            className="w-20 rounded-sm border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-ink"
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(level.id)}
                            className="rounded-sm bg-teal-glow px-2.5 py-1.5 text-[11.5px] font-semibold text-teal"
                          >
                            Uložit
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-sm border border-line-strong px-2.5 py-1.5 text-[11.5px] text-ink-dim"
                          >
                            Zrušit
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] font-semibold text-ink">{level.name}</span>
                          <span className="text-[11.5px] text-ink-faint">{level.threshold} pozvání</span>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEdit(level)}
                            className="rounded-sm border border-line-strong px-2.5 py-1.5 text-[11.5px] text-ink-dim"
                          >
                            Upravit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(level.id)}
                            className="rounded-sm border border-danger-soft bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger"
                          >
                            Smazat
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </BusinessShell>
  );
}
