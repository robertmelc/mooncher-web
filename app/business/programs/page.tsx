"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { programStatusLabel } from "@/lib/programs";

type Program = {
  id: string;
  name: string;
  voucher_type: string;
  status: string;
  currency: string;
  created_at: string;
};

export default function BusinessProgramsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [programs, setPrograms] = useState<Program[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(null);

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

    async function loadPrograms() {
      // Dočasně přes Route Handler (service role) — viz lib/business-auth.ts.
      const res = await fetch("/api/business/programs", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setPrograms(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setPrograms(json.programs);
    }

    loadPrograms();
  }, [session]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Programy</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/business/programs")}`}
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
    <BusinessShell title="Programy">
      {authLoading || programs === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : programs === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="font-display text-base font-bold">Programy</span>
            <button
              type="button"
              onClick={() => setPlaceholderMessage("K dispozici brzy.")}
              className="rounded-sm bg-teal px-3.5 py-2 text-[12.5px] font-semibold text-[#04211B]"
            >
              + Nový program
            </button>
          </div>
          {placeholderMessage && <p className="text-[11.5px] text-teal">{placeholderMessage}</p>}

          {programs.length === 0 ? (
            <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
              Zatím žádné programy.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {programs.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-sm p-3.5"
                  style={{
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <span className="text-[13.5px] font-semibold">{p.name}</span>
                  <div className="flex items-center gap-3">
                    {p.status !== "retired" && (
                      <Link href={`/business/programs/${p.id}/network`} className="text-[11.5px] text-teal underline">
                        Nastavit síť
                      </Link>
                    )}
                    <span className={`badge ${p.status === "active" ? "" : "gray"}`}>
                      {programStatusLabel(p.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </BusinessShell>
  );
}
