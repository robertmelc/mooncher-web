"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export default function EndUserHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    async function ensureEndUser() {
      const { data: existing, error: selectError } = await supabase
        .from("vpc_end_users")
        .select("id")
        .eq("auth_user_id", session!.user.id)
        .maybeSingle();

      if (selectError) {
        setStatus(`Chyba při čtení vpc_end_users: ${selectError.message}`);
        return;
      }

      if (existing) return;

      const { error: insertError } = await supabase.from("vpc_end_users").insert({
        auth_user_id: session!.user.id,
        email: session!.user.email,
      });

      if (insertError) {
        setStatus(`Chyba při vytváření vpc_end_users: ${insertError.message}`);
      }
    }

    ensureEndUser();
  }, [session]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-2xl font-semibold">/app — koncový uživatel</h1>
      <p className="text-sm text-neutral-500">
        Peněženka, transaction feed, detail vouchru — viz B6 §1.
      </p>

      {loading ? (
        <p className="text-sm font-mono">Ověřuji přihlášení…</p>
      ) : session ? (
        <p className="text-sm font-mono">Přihlášen jako: {session.user.email}</p>
      ) : (
        <p className="text-sm font-mono">
          Nejste přihlášeni —{" "}
          <Link href="/app/login" className="underline">
            přihlásit se
          </Link>
        </p>
      )}

      {status && <p className="text-sm font-mono text-red-600">{status}</p>}
    </main>
  );
}
