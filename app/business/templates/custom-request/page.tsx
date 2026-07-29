"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { Button } from "@/components/Button";
import { TEMPLATE_CATEGORIES, templateCategoryLabel } from "@/lib/templates";

export default function CustomTemplateRequestPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOperator, setIsOperator] = useState<boolean | undefined>(undefined);

  const [category, setCategory] = useState("gift");
  const [description, setDescription] = useState("");
  const [desiredDeadline, setDesiredDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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

    async function loadOperator() {
      const res = await fetch("/api/business/operator", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      setIsOperator(res.ok);
    }

    loadOperator();
  }, [session]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const res = await fetch("/api/business/templates/custom-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
      body: JSON.stringify({ category, description, desiredDeadline }),
    });
    const json = await res.json();

    setSubmitting(false);
    setResult({ ok: json.ok, message: json.ok ? "Žádost odeslána. Ozveme se vám." : (json.error ?? "Odeslání se nezdařilo.") });

    if (json.ok) {
      setDescription("");
      setDesiredDeadline("");
    }
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Vlastní design šablony</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/business/templates/custom-request")}`}
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
    <BusinessShell title="Vlastní design šablony">
      {authLoading || isOperator === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : !isOperator ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-3.5">
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            Placená služba — postavíme vám novou šablonu na míru. Ozveme se s odhadem ceny a lhůty po
            konzultaci.
          </p>

          <label className="text-[11.5px] text-ink-faint">Kategorie</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {templateCategoryLabel(c)}
              </option>
            ))}
          </select>

          <label className="text-[11.5px] text-ink-faint">Popis požadavku</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Co má šablona umět, jaký má mít styl, na co navazuje…"
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <label className="text-[11.5px] text-ink-faint">Termín (nepovinné)</label>
          <input
            type="text"
            value={desiredDeadline}
            onChange={(e) => setDesiredDeadline(e.target.value)}
            placeholder="např. do 15. 8."
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <Button type="submit" className="mt-2 max-w-[220px]" disabled={submitting}>
            {submitting ? "Odesílám…" : "Odeslat žádost"}
          </Button>

          {result && (
            <p className={`text-[11.5px] ${result.ok ? "text-positive" : "text-danger"}`}>{result.message}</p>
          )}
        </form>
      )}
    </BusinessShell>
  );
}
