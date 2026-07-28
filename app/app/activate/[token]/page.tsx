"use client";

import { useEffect, useState } from "react";
import { MoonMark } from "@/components/MoonMark";
import { Button } from "@/components/Button";

type VoucherPreview = {
  eyebrow: string;
  title: string;
  subtitle: string;
  issuedToName: string | null;
};

export default function ActivateVoucherPage({ params }: { params: { token: string } }) {
  const [preview, setPreview] = useState<VoucherPreview | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    async function loadPreview() {
      const res = await fetch(`/api/activate/${params.token}`);
      const json = await res.json();
      setPreview(json.ok ? json.voucher : null);
    }
    loadPreview();
  }, [params.token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const res = await fetch(`/api/activate/${params.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const json = await res.json();
    setSubmitting(false);
    setResult({ ok: json.ok, message: json.ok ? "Voucher byl aktivován." : json.error });
  }

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <MoonMark size={56} />

        {preview === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám voucher…</p>
        ) : preview === null ? (
          <div className="w-full rounded-sm border border-dashed border-line-strong p-6 text-sm text-ink-faint">
            Voucher nenalezen nebo už byl aktivován.
          </div>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold tracking-tight">Dostali jste voucher</h1>
            <p className="text-[13px] text-ink-dim">
              {preview.title} · {preview.subtitle}
              {preview.issuedToName ? ` · pro ${preview.issuedToName}` : ""}
            </p>

            {result?.ok ? (
              <p className="mt-4 text-sm text-positive">{result.message}</p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 flex w-full flex-col gap-3">
                <input
                  type="tel"
                  required
                  placeholder="+420 000 000 000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-center text-sm text-ink"
                />
                <Button type="submit">{submitting ? "Aktivuji…" : "Aktivovat voucher"}</Button>
                {result && !result.ok && (
                  <p className="text-[11.5px] text-danger">{result.message}</p>
                )}
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
