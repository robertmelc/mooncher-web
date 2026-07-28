"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { Button } from "@/components/Button";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });

    setLoading(false);

    if (error) {
      setStatus(`Chyba: ${error.message}`);
      return;
    }

    setStatus("Zkontrolujte e-mail a klikněte na odkaz pro přihlášení.");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-24 text-center">
      <MoonMark size={44} />
      <h1 className="font-display text-2xl font-bold tracking-tight">Přihlášení</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="email"
          required
          placeholder="vas@email.cz"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-sm border border-line-strong bg-panel px-3.5 py-3 text-center text-sm text-ink"
        />
        <Button type="submit">{loading ? "Odesílám…" : "Poslat přihlašovací odkaz"}</Button>
      </form>
      {status && <p className="text-[11.5px] text-ink-dim">{status}</p>}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
