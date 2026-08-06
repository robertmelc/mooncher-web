"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/Button";

type Member = {
  split_percent: number;
  voucher_program: { id: string; name: string; client: { id: string; name: string } | null } | null;
};

type Program = {
  id: string;
  name: string;
  currency: string;
  client_group: { name: string } | null;
  members: Member[];
};

export default function AdminMultiIssuerPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [programs, setPrograms] = useState<Program[] | null | undefined>(undefined);

  const [programId, setProgramId] = useState("");
  const [phone, setPhone] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [useOverrides, setUseOverrides] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; code?: string } | null>(null);

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
      const res = await fetch("/api/admin/multi-issuer/programs", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setPrograms(json.programs);
      } else {
        setPrograms(null);
      }
    }

    loadPrograms();
  }, [session]);

  const selectedProgram = programs?.find((p) => p.id === programId) ?? null;

  function computeDefaultSplit(program: Program, total: number): Record<string, number> {
    if (!total) return {};
    const out: Record<string, number> = {};
    let allocated = 0;
    const members = program.members.filter((m) => m.voucher_program);
    members.forEach((m, i) => {
      const pid = m.voucher_program!.id;
      if (i === members.length - 1) {
        out[pid] = Math.round(total - allocated);
      } else {
        const share = Math.round((total * m.split_percent) / 100);
        out[pid] = share;
        allocated += share;
      }
    });
    return out;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selectedProgram) return;

    const numericTotal = Number(totalAmount);
    if (!numericTotal || numericTotal <= 0 || !phone.trim()) {
      setResult({ ok: false, message: "Vyplňte telefon a kladnou celkovou částku." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    const body: {
      multiIssuerProgramId: string;
      targetPhone: string;
      totalAmount: number;
      idempotencyKey: string;
      overrides?: { voucherProgramId: string; amount: number }[];
    } = {
      multiIssuerProgramId: selectedProgram.id,
      targetPhone: phone.trim(),
      totalAmount: numericTotal,
      idempotencyKey: crypto.randomUUID(),
    };

    if (useOverrides) {
      body.overrides = Object.entries(overrides).map(([voucherProgramId, amount]) => ({
        voucherProgramId,
        amount: Number(amount) || 0,
      }));
    }

    const res = await fetch("/api/admin/multi-issuer/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setResult({ ok: false, message: json.error ?? "Vydání se nezdařilo." });
      return;
    }

    setResult({ ok: true, message: "Karta vydána.", code: json.code });
  }

  const defaultSplit = selectedProgram ? computeDefaultSplit(selectedProgram, Number(totalAmount) || 0) : {};

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Vícevydavatelské karty</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/multi-issuer")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Vícevydavatelské karty">
      {authLoading || programs === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : programs === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : programs.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">
          Zatím žádný vícevydavatelský program — skupiny a programy se zatím zakládají SQL, ne v UI.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2.5">
          <label className="text-[11.5px] text-ink-faint">Program</label>
          <select
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value);
              setUseOverrides(false);
            }}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          >
            <option value="">Vyberte program</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.client_group ? `— ${p.client_group.name}` : ""}
              </option>
            ))}
          </select>

          {selectedProgram && (
            <p className="text-[11px] text-ink-faint">
              {selectedProgram.members
                .filter((m) => m.voucher_program)
                .map((m) => `${m.voucher_program!.client?.name ?? m.voucher_program!.name} ${m.split_percent}%`)
                .join(" · ")}
            </p>
          )}

          <label className="mt-1 text-[11.5px] text-ink-faint">Telefon výherce/držitele</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+420 604 251 244"
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <label className="mt-1 text-[11.5px] text-ink-faint">Celková částka</label>
          <input
            type="number"
            min={1}
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          {selectedProgram && Number(totalAmount) > 0 && (
            <div className="mt-1 flex flex-col gap-2 rounded-sm border border-line-strong p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-ink-faint">Rozdělení mezi firmy</span>
                <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <input
                    type="checkbox"
                    checked={useOverrides}
                    onChange={(e) => {
                      setUseOverrides(e.target.checked);
                      if (e.target.checked) setOverrides({ ...defaultSplit } as unknown as Record<string, string>);
                    }}
                  />
                  Upravit ručně
                </label>
              </div>
              {selectedProgram.members
                .filter((m) => m.voucher_program)
                .map((m) => {
                  const pid = m.voucher_program!.id;
                  const value = useOverrides ? (overrides[pid] ?? String(defaultSplit[pid] ?? "")) : String(defaultSplit[pid] ?? "");
                  return (
                    <div key={pid} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-ink-dim">{m.voucher_program!.client?.name ?? m.voucher_program!.name}</span>
                      {useOverrides ? (
                        <input
                          type="number"
                          value={value}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [pid]: e.target.value }))}
                          className="w-24 rounded-sm border border-line-strong bg-panel px-2 py-1 text-right text-ink"
                        />
                      ) : (
                        <span className="text-ink">{value} Kč</span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <Button type="submit" className="mt-2" disabled={submitting || !selectedProgram}>
            {submitting ? "Vydávám…" : "Vydat kartu"}
          </Button>

          {result && (
            <p className={`text-[11.5px] ${result.ok ? "text-positive" : "text-danger"}`}>
              {result.message} {result.code && `(${result.code})`}
            </p>
          )}
        </form>
      )}
    </AdminShell>
  );
}
