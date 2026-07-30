"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { actorTypeLabel } from "@/lib/audit";

type AuditRow = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_table: string;
  target_id: string;
  created_at: string;
};

const WINDOW_OPTIONS = [
  { value: "24h", label: "Posledních 24 hodin" },
  { value: "7d", label: "Posledních 7 dní" },
  { value: "30d", label: "Posledních 30 dní" },
  { value: "all", label: "Vše" },
];

const ACTOR_TYPE_OPTIONS = ["client_operator", "end_user", "platform_admin", "system"];

export default function AdminAuditLogPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rows, setRows] = useState<AuditRow[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [window_, setWindow] = useState("7d");
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");

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

    async function loadAuditLog() {
      const params = new URLSearchParams({ window: window_ });
      if (actorType) params.set("actorType", actorType);

      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setRows(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      setRows(json.rows);
      setAction("");
    }

    loadAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, window_, actorType]);

  const availableActions = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => r.action));
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    return action ? rows.filter((r) => r.action === action) : rows;
  }, [rows, action]);

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Audit log</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/admin/audit-log")}`}
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
    <AdminShell title="Audit log">
      {authLoading || rows === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : rows === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2.5">
            <select
              value={window_}
              onChange={(e) => setWindow(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-[12.5px] text-ink"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              value={actorType}
              onChange={(e) => setActorType(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-[12.5px] text-ink"
            >
              <option value="">Všichni aktéři</option>
              {ACTOR_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {actorTypeLabel(t)}
                </option>
              ))}
            </select>

            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-[12.5px] text-ink"
            >
              <option value="">Všechny akce</option>
              {availableActions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {filteredRows && filteredRows.length === 0 ? (
            <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
              Žádné záznamy pro zvolený filtr.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="py-2 pr-3 font-mono font-semibold">Čas</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Aktér</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Akce</th>
                    <th className="py-2 pr-3 font-mono font-semibold">Cíl</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows?.map((r) => (
                    <tr key={r.id} className="border-b border-line text-ink-dim">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {actorTypeLabel(r.actor_type)}
                        {r.actor_id && (
                          <span className="pl-1 font-mono text-[10.5px] text-ink-faint">
                            {r.actor_id.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">{r.action}</td>
                      <td className="py-2 pr-3 font-mono text-[10.5px] text-ink-faint">
                        {r.target_table}:{r.target_id.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
