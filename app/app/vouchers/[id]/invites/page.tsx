"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type Invite = {
  id: string;
  phone: string;
  status: string;
  sentAt: string;
  joinedAt: string | null;
  joinedName: string | null;
  joinedEmail: string | null;
};

export default function VoucherInvitesPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [invites, setInvites] = useState<Invite[] | null | undefined>(undefined);
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
    if (!session?.access_token) return;

    async function loadInvites() {
      const res = await fetch(`/api/vouchers/${params.id}/referral/invites`, {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setInvites(json.invites);
      } else {
        setError(json.error ?? "Načtení se nezdařilo.");
      }
    }

    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, params.id]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="flex items-center gap-3 border-b border-line pb-4">
          <Link href={`/app/vouchers/${params.id}`} className="text-lg text-ink-dim">
            ‹
          </Link>
          <h1 className="font-display text-lg font-bold tracking-tight">Moje pozvánky</h1>
        </header>

        {authLoading || invites === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/app/vouchers/${params.id}/invites`)}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : invites && invites.length === 0 ? (
          <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
            Zatím žádné odeslané SMS pozvánky.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {invites?.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-line-strong px-3.5 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {invite.joinedName ?? invite.phone}
                  </span>
                  <span className="truncate text-[11px] text-ink-faint">
                    {invite.joinedEmail ?? invite.phone}
                  </span>
                </div>
                <span className={`badge ${invite.status === "joined" ? "" : "gray"}`}>
                  {invite.status === "joined" ? "Připojen/a" : "Čeká"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
