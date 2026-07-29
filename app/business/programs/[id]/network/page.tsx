"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { Button } from "@/components/Button";

type NetworkScope =
  | { type: "single_merchant"; merchant_ids: string[] }
  | { type: "defined_goods"; categories: string[] };

type Program = {
  id: string;
  name: string;
  status: string;
  network_scope: NetworkScope | null;
  design_config: Record<string, unknown> | null;
};

export default function NetworkScopePage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [program, setProgram] = useState<Program | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [scopeType, setScopeType] = useState<"single_merchant" | "defined_goods" | null>(null);
  const [categoriesInput, setCategoriesInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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

    async function loadProgram() {
      const res = await fetch("/api/business/programs", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setProgram(null);
        } else {
          setError(json.error ?? "Načtení se nezdařilo.");
        }
        return;
      }

      const found = (json.programs as Program[]).find((p) => p.id === params.id);
      setProgram(found ?? null);

      if (found?.network_scope) {
        setScopeType(found.network_scope.type);
        if (found.network_scope.type === "defined_goods") {
          setCategoriesInput(found.network_scope.categories.join(", "));
        }
      }
    }

    loadProgram();
  }, [session, params.id]);

  async function handleSave() {
    if (!session || !scopeType) return;

    // merchant_ids dosadí server podle ověřeného operátora — viz route.ts.
    const networkScope: NetworkScope =
      scopeType === "single_merchant"
        ? { type: "single_merchant", merchant_ids: [] }
        : {
            type: "defined_goods",
            categories: categoriesInput
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
          };

    setSaving(true);
    setSaveMessage(null);

    const res = await fetch(`/api/business/programs/${params.id}/network`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ networkScope }),
    });
    const json = await res.json();

    setSaving(false);

    if (!res.ok) {
      setSaveMessage(json.error ?? "Uložení se nezdařilo.");
      return;
    }

    setSaveMessage(json.activated ? "Uloženo — program je teď aktivní." : "Uloženo.");
    setProgram((prev) => (prev ? { ...prev, status: json.activated ? "active" : prev.status } : prev));
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Nastavení sítě</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/business/programs/${params.id}/network`)}`}
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
    <BusinessShell title="Kde bude voucher platit">
      {authLoading || program === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : program === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Program nenalezen.
        </div>
      ) : (
        <div className="flex max-w-lg flex-col gap-3.5">
          <p className="text-[13px] text-ink-dim">
            Pro program <span className="font-semibold text-ink">{program.name}</span>
          </p>

          {!program.design_config || Object.keys(program.design_config).length === 0 ? (
            <p className="rounded-sm border border-dashed border-line-strong p-3 text-[11.5px] text-ink-faint">
              Program zatím nemá nastavený vzhled — můžete to doplnit v Šablonách.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setScopeType("single_merchant")}
            className="flex items-center gap-3 rounded-sm p-3.5 text-left"
            style={{
              border: scopeType === "single_merchant" ? "1px solid var(--teal)" : "1px solid rgba(255,255,255,.12)",
              background:
                scopeType === "single_merchant"
                  ? "var(--teal-glow)"
                  : "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
            }}
          >
            <span
              className="h-5 w-5 flex-shrink-0 rounded-full"
              style={{
                border: `2px solid ${scopeType === "single_merchant" ? "var(--teal)" : "var(--line-strong)"}`,
                background: scopeType === "single_merchant" ? "var(--teal-glow)" : "transparent",
              }}
            />
            <span>
              <div className="text-[13.5px] font-semibold">Jen v mé síti</div>
              <div className="text-[11.5px] text-ink-faint">Voucher platí výhradně u vašich poboček/e-shopu</div>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setScopeType("defined_goods")}
            className="flex items-center gap-3 rounded-sm p-3.5 text-left"
            style={{
              border: scopeType === "defined_goods" ? "1px solid var(--teal)" : "1px solid rgba(255,255,255,.12)",
              background:
                scopeType === "defined_goods"
                  ? "var(--teal-glow)"
                  : "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
            }}
          >
            <span
              className="h-5 w-5 flex-shrink-0 rounded-full"
              style={{
                border: `2px solid ${scopeType === "defined_goods" ? "var(--teal)" : "var(--line-strong)"}`,
                background: scopeType === "defined_goods" ? "var(--teal-glow)" : "transparent",
              }}
            />
            <span>
              <div className="text-[13.5px] font-semibold">Definovaný sortiment</div>
              <div className="text-[11.5px] text-ink-faint">Voucher platí jen na vybrané kategorie zboží/služeb</div>
            </span>
          </button>

          {scopeType === "defined_goods" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] text-ink-faint">Kategorie (oddělené čárkou)</label>
              <input
                type="text"
                value={categoriesInput}
                onChange={(e) => setCategoriesInput(e.target.value)}
                placeholder="např. kávové nápoje, pečivo"
                className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
              />
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={!scopeType || saving || program.status === "retired"}
            className="mt-2 max-w-[200px]"
          >
            {saving ? "Ukládám…" : "Uložit rozsah"}
          </Button>
          {saveMessage && (
            <p className={`text-[11.5px] ${saveMessage.startsWith("Uloženo") ? "text-positive" : "text-danger"}`}>
              {saveMessage}
            </p>
          )}
        </div>
      )}
    </BusinessShell>
  );
}
