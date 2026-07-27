"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function EndUserHome() {
  const [status, setStatus] = useState<string>("Ověřuji připojení k Supabase…");

  useEffect(() => {
    async function checkConnection() {
      const { count, error } = await supabase
        .from("vpc_voucher_templates")
        .select("*", { count: "exact", head: true });

      if (error) {
        setStatus(`Supabase připojení: CHYBA (${error.message})`);
        return;
      }

      setStatus(`Supabase připojení: OK (${count ?? 0} šablon)`);
    }

    checkConnection();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-2xl font-semibold">/app — koncový uživatel</h1>
      <p className="text-sm text-neutral-500">
        Peněženka, transaction feed, detail vouchru — viz B6 §1.
      </p>
      <p className="text-sm font-mono">{status}</p>
    </main>
  );
}
