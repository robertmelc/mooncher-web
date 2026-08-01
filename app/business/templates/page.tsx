"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { TEMPLATE_CATEGORIES, templateCategoryLabel } from "@/lib/templates";

type Template = {
  id: string;
  name: string;
  category: string;
  thumbnail_url: string | null;
};

export default function BusinessTemplatesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOperator, setIsOperator] = useState<boolean | undefined>(undefined);
  const [templates, setTemplates] = useState<Template[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

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
      // Ověření, že jde o platného client_operatora — viz lib/business-auth.ts.
      const res = await fetch("/api/business/operator", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      setIsOperator(res.ok);
    }

    loadOperator();
  }, [session]);

  useEffect(() => {
    if (!isOperator) return;

    async function loadTemplates() {
      // Service role přes Route Handler — přímý klientský RLS dotaz jako
      // client_operator tiše selhává (HARDENING.md #1), takže by operátor
      // viděl jen sdílené šablony, ne svoje vlastní exkluzivní.
      const res = await fetch("/api/business/templates", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Načtení se nezdařilo.");
        return;
      }

      setTemplates(json.templates);
    }

    loadTemplates();
  }, [isOperator]);

  const filteredTemplates = templates?.filter((t) => !category || t.category === category);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Šablony</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/business/templates")}`}
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
    <BusinessShell title="Galerie šablon">
      {authLoading || isOperator === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : !isOperator ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : templates === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám šablony…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={`badge ${category === null ? "" : "gray"}`}
            >
              Vše
            </button>
            {TEMPLATE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`badge ${category === c ? "" : "gray"}`}
              >
                {templateCategoryLabel(c)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {filteredTemplates?.map((t) => (
              <Link key={t.id} href={`/business/templates/${t.id}`} className="thumb block">
                <div className="art" />
                <div className="px-3 py-2.5 text-[12px] font-semibold">{t.name}</div>
              </Link>
            ))}

            <Link
              href="/business/templates/custom-request"
              className="thumb flex flex-col items-center justify-center gap-1 p-4 text-center text-[12px] font-semibold text-ink-dim"
            >
              <span className="text-lg leading-none text-teal">+</span>
              <span>Vlastní design</span>
            </Link>
          </div>
        </>
      )}
    </BusinessShell>
  );
}
