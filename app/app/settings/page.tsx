"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { MoonMark } from "@/components/MoonMark";
import { Button } from "@/components/Button";
import { verificationTierLabel } from "@/lib/endUser";

type EndUser = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  verification_tier: string;
};

type AppAccess = { isAdmin: boolean; isClientOperator: boolean; clientName: string | null };

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className="text-[13px] text-ink">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [endUser, setEndUser] = useState<EndUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [eclipseMessage, setEclipseMessage] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeMessage, setCloseMessage] = useState<string | null>(null);

  const [access, setAccess] = useState<AppAccess | null>(null);

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

    async function loadEndUser() {
      const { data, error: fetchError } = await supabase
        .from("vpc_end_users")
        .select("first_name, last_name, phone, email, verification_tier")
        .eq("auth_user_id", session!.user.id)
        .maybeSingle();

      if (fetchError) {
        setError(`Chyba při čtení vpc_end_users: ${fetchError.message}`);
        return;
      }

      setEndUser(data);
      setFirstName(data?.first_name ?? "");
      setLastName(data?.last_name ?? "");
    }

    loadEndUser();
  }, [session]);

  useEffect(() => {
    if (!session) return;

    async function loadAccess() {
      const res = await fetch("/api/app/access", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setAccess({ isAdmin: json.isAdmin, isClientOperator: json.isClientOperator, clientName: json.clientName });
      }
    }

    loadAccess();
    // session je tu záměrně mimo dependency array — celý objekt mění
    // referenci i při neškodném obnovení tokenu (HARDENING.md #4).
    // session?.user?.id je stabilní přes token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    const { error: updateError } = await supabase
      .from("vpc_end_users")
      .update({ first_name: firstName, last_name: lastName })
      .eq("auth_user_id", session!.user.id);

    setSaving(false);

    if (updateError) {
      setSaveMessage(`Chyba: ${updateError.message}`);
      return;
    }

    setSaveMessage("Uloženo.");
    setEndUser((prev) => (prev ? { ...prev, first_name: firstName, last_name: lastName } : prev));
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/app/login");
  }

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-2.5">
          <MoonMark />
          <h1 className="font-display text-2xl font-bold tracking-tight">Nastavení</h1>
        </header>

        {authLoading ? (
          <p className="font-mono text-sm text-ink-dim">Ověřuji přihlášení…</p>
        ) : !session ? (
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/app/settings")}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        ) : error ? (
          <p className="font-mono text-sm text-danger">{error}</p>
        ) : endUser === undefined ? (
          <p className="font-mono text-sm text-ink-dim">Načítám…</p>
        ) : (
          <>
            {/* Eclipse karta */}
            <div
              className="relative overflow-hidden rounded-sm p-4"
              style={{
                border: "1px solid rgba(232,194,122,.35)",
                background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
                backdropFilter: "blur(10px)",
              }}
            >
              <div className="eclipse-glow" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MoonMark size={22} />
                  <span className="font-display text-sm font-extrabold">Eclipse</span>
                </div>
                <span className="badge">
                  {endUser ? verificationTierLabel(endUser.verification_tier) : "Neověřeno"}
                </span>
              </div>
              <p className="relative z-10 my-2 text-[11.5px] leading-relaxed text-ink-faint">
                Ověřený účet s vyššími limity. Připraveno pro KYC a napojení na platebního partnera.
              </p>
              <button
                type="button"
                onClick={() => setEclipseMessage("K dispozici brzy.")}
                className="relative z-10 rounded-sm border border-dashed border-line-strong px-3.5 py-2 text-[11.5px] font-medium text-ink-dim"
              >
                Zahájit ověření
              </button>
              {eclipseMessage && (
                <p className="relative z-10 mt-2 text-[11.5px] text-teal">{eclipseMessage}</p>
              )}
            </div>

            {/* Jméno / příjmení — editovatelné */}
            <form onSubmit={handleSave} className="flex flex-col gap-2">
              <label className="text-[11.5px] text-ink-faint">Jméno</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-sm border border-line-strong bg-panel px-3.5 py-2.5 text-sm text-ink"
              />
              <label className="text-[11.5px] text-ink-faint">Příjmení</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-sm border border-line-strong bg-panel px-3.5 py-2.5 text-sm text-ink"
              />
              <Button type="submit" className="mt-1">
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
              {saveMessage && (
                <p className={`text-[11.5px] ${saveMessage.startsWith("Chyba") ? "text-danger" : "text-positive"}`}>
                  {saveMessage}
                </p>
              )}
            </form>

            {/* Needitovatelné údaje */}
            <div className="mt-1">
              <SettingsRow label="Telefonní číslo" value={endUser?.phone ?? "—"} />
              <SettingsRow label="E-mail" value={endUser?.email ?? "—"} />
              <SettingsRow label="Notifikace" value="Zapnuto" />
              <SettingsRow label="Jazyk" value="Čeština" />
            </div>

            {/* Uzavření účtu */}
            {!showCloseConfirm ? (
              <button
                type="button"
                onClick={() => setShowCloseConfirm(true)}
                className="mt-4 rounded-sm border border-danger-soft bg-danger-soft px-3.5 py-2.5 text-center text-[13px] font-medium text-danger"
              >
                Požádat o uzavření účtu
              </button>
            ) : (
              <div className="mt-4 flex flex-col gap-3 rounded-sm border border-line-strong p-4">
                <p className="text-[11.5px] leading-relaxed text-ink-dim">
                  Uzavření účtu nemaže vaše transakce ani vouchery okamžitě — jde o žádost o
                  anonymizaci. Vaše jméno, telefon a e-mail nahradíme anonymizovaným záznamem a
                  přihlášení k účtu přestane fungovat. Historické transakce zůstávají zachovány
                  (bez osobní identifikace) kvůli auditu a případným účetním povinnostem klientů.
                </p>
                {closeMessage ? (
                  <p className="text-[11.5px] text-teal">{closeMessage}</p>
                ) : (
                  <div className="flex gap-3">
                    <Button
                      variant="ghost"
                      onClick={() => setShowCloseConfirm(false)}
                      className="flex-1"
                    >
                      Zpět
                    </Button>
                    <Button
                      onClick={() => setCloseMessage("Tato funkce bude dostupná v příští fázi.")}
                      className="flex-1"
                    >
                      Potvrdit žádost
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Přepínač rozhraní — vidí jen identita, co danou roli skutečně má
                (viz app/api/app/access/route.ts). Pro běžného end_usera se
                tenhle blok vůbec nevykreslí. */}
            {access && (access.isAdmin || access.isClientOperator) && (
              <div className="mt-4 flex flex-col gap-2">
                <span className="text-[11.5px] text-ink-faint">Další rozhraní</span>
                {access.isClientOperator && (
                  <Link
                    href="/business"
                    className="rounded-sm border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[13px] font-medium text-ink-dim"
                  >
                    Přepnout na Business{access.clientName ? ` (${access.clientName})` : ""}
                  </Link>
                )}
                {access.isAdmin && (
                  <Link
                    href="/admin"
                    className="rounded-sm border border-dashed border-line-strong px-3.5 py-2.5 text-center text-[13px] font-medium text-ink-dim"
                  >
                    Přepnout na Admin
                  </Link>
                )}
              </div>
            )}

            <Button variant="ghost" onClick={handleSignOut} className="mt-2">
              Odhlásit se
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
