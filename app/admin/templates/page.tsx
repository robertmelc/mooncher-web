"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { templateCategoryLabel } from "@/lib/templates";

type Template = {
  id: string;
  name: string;
  category: string;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  is_active: boolean;
  owner: { name: string } | null;
};

export default function AdminTemplatesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[] | null | undefined>(undefined);
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

    async function loadTemplates() {
      const res = await fetch("/api/admin/templates", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setTemplates(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setTemplates(json.templates);
    }

    loadTemplates();
  }, [session]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Šablony</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/templates")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Šablony">
      {authLoading || templates === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : templates === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/admin/templates/${t.id}`}
              className="thumb block"
              style={{ opacity: t.is_active ? 1 : 0.5 }}
            >
              <div className="art" />
              <div className="px-3 py-2.5">
                <div className="text-[12px] font-semibold">{t.name}</div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="badge gray">{templateCategoryLabel(t.category)}</span>
                  {t.owner_client_id && <span className="badge gray">{t.owner?.name ?? "Exkluzivní"}</span>}
                  {!t.is_active && <span className="badge danger">Neaktivní</span>}
                </div>
              </div>
            </Link>
          ))}

          <Link
            href="/admin/templates/new"
            className="thumb flex flex-col items-center justify-center gap-1 p-4 text-center text-[12px] font-semibold text-ink-dim"
          >
            <span className="text-lg leading-none text-teal">+</span>
            <span>Nahrát šablonu</span>
          </Link>
        </div>
      )}
    </AdminShell>
  );
}
