"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/Button";

type Client = { id: string; name: string };
type Program = { id: string; name: string; status: string; currency: string };

function IssueVoucherForm() {
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [clients, setClients] = useState<Client[] | null | undefined>(undefined);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [clientId, setClientId] = useState("");
  const [programId, setProgramId] = useState("");
  const [amount, setAmount] = useState("500");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [message, setMessage] = useState(searchParams.get("message") ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; voucherId?: string } | null>(null);

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

    async function loadClients() {
      const res = await fetch("/api/admin/clients", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setClients(json.clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      } else {
        setClients(null);
      }
    }

    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session || !clientId) {
      setPrograms([]);
      setProgramId("");
      return;
    }

    async function loadPrograms() {
      const res = await fetch(`/api/admin/clients/${clientId}/programs`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setPrograms(json.programs);
        setProgramId("");
      }
    }

    loadPrograms();
    // session je tu záměrně mimo dependency array — celý objekt mění
    // referenci i při neškodném obnovení tokenu (HARDENING.md #4), což by
    // tenhle efekt zbytečně re-spustilo a smazalo právě vybraný program i
    // beze změny klienta. session?.user?.id je stabilní přes token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, clientId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;

    const numericAmount = Number(amount);
    if (!clientId || !programId || !numericAmount || numericAmount <= 0) {
      setResult({ ok: false, message: "Vyberte klienta, program a zadejte platnou částku." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    const res = await fetch("/api/admin/issue-voucher", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        clientId,
        programId,
        amount: numericAmount,
        recipientPhone: recipientPhone || undefined,
        message: message || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const json = await res.json();
    setSubmitting(false);

    if (json.ok) {
      setResult({ ok: true, message: "Voucher vydán.", voucherId: json.voucherId });
    } else {
      setResult({ ok: false, message: json.error ?? "Vydání se nezdařilo." });
    }
  }

  const activationUrl =
    result?.ok && result.voucherId && typeof window !== "undefined"
      ? `${window.location.origin}/app/activate/${result.voucherId}`
      : null;

  async function handleCopyLink() {
    if (!activationUrl) return;
    await navigator.clipboard.writeText(activationUrl);
  }

  async function handleShareLink() {
    if (!activationUrl) return;
    if (navigator.share) {
      await navigator.share({ title: "Voucher", url: activationUrl });
    }
  }

  function handleIssueAnother() {
    setResult(null);
    setAmount("500");
    setRecipientPhone("");
    setMessage("");
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Vydat voucher</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link href={`/app/login?next=${encodeURIComponent("/admin/issue-voucher")}`} className="text-teal underline">
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Vydat voucher">
      {authLoading || clients === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : clients === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Nemáte oprávnění k tomuto rozhraní.
        </div>
      ) : result?.ok ? (
        <div className="flex flex-col items-center gap-4 rounded-sm border border-line-strong p-6 text-center">
          <p className="text-sm text-ink">Voucher byl vytvořen. Aktivační odkaz pošlete výherci sami.</p>
          <p className="break-all rounded-sm bg-panel2 px-3 py-2 font-mono text-[11px] text-ink-dim">
            {activationUrl}
          </p>
          <div className="flex w-full gap-2">
            <Button variant="ghost" className="flex-1" onClick={handleCopyLink}>
              Kopírovat odkaz
            </Button>
            <Button className="flex-1" onClick={handleShareLink}>
              Sdílet
            </Button>
          </div>
          <Button variant="ghost" onClick={handleIssueAnother}>
            Vydat další
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <label className="text-[11.5px] text-ink-faint">Klient</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          >
            <option value="">Vyberte klienta</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label className="mt-1 text-[11.5px] text-ink-faint">Program</label>
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            disabled={!clientId}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            <option value="">{clientId ? "Vyberte program" : "Nejdřív vyberte klienta"}</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.currency})
              </option>
            ))}
          </select>

          <label className="mt-1 text-[11.5px] text-ink-faint">Částka</label>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <label className="mt-1 text-[11.5px] text-ink-faint">Telefon příjemce (nepovinné)</label>
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="+420 xxx xxx xxx"
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <label className="mt-1 text-[11.5px] text-ink-faint">Zpráva</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />

          <Button type="submit" className="mt-2" disabled={submitting}>
            {submitting ? "Vydávám…" : "Vydat voucher"}
          </Button>
          {result && !result.ok && <p className="text-[11.5px] text-danger">{result.message}</p>}
        </form>
      )}
    </AdminShell>
  );
}

export default function AdminIssueVoucherPage() {
  return (
    <Suspense fallback={null}>
      <IssueVoucherForm />
    </Suspense>
  );
}
