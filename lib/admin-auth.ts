import { createAdminClient } from "@/lib/supabase/admin";

/**
 * platform_admin role — DOČASNÉ ŘEŠENÍ (viz konverzace k obrazovce adm-1):
 * seznam adminů je natvrdo v env proměnné PLATFORM_ADMIN_EMAILS (server-only),
 * ne v DB tabulce. Tohle je záměrně přísnější, ne jednodušší volba — /admin
 * vidí data všech klientů platformy najednou, takže čím méně způsobů, jak
 * někomu přístup přidat/odebrat za běhu (bez redeploye), tím menší riziko
 * náhodného rozšíření nejcitlivějšího oprávnění v appce (např. omylem přes
 * service roli při budoucím testování, jak jsme dělali u /business dat).
 *
 * Pokud by v budoucnu dávala smysl samoobslužná správa adminů (větší tým),
 * jde o vědomý hardening krok směrem k tabulce + RLS — ne výchozí stav.
 */

export type AdminResult = { ok: true; email: string } | { ok: false; status: number; error: string };

// Čistá kontrola bez DB/audit vedlejších efektů — pro pasivní "má tenhle
// e-mail admin roli?" dotazy (např. přepínač rozhraní v Nastavení), kde by
// audit-log zápis na zamítnutí (viz níže) byl nesmyslný šum při každém
// otevření stránky běžným uživatelem. Ostré volání admin API pořád jde přes
// resolveAdmin(), který auditování zachovává.
export function isPlatformAdminEmail(email: string): boolean {
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

export async function resolveAdmin(
  admin: ReturnType<typeof createAdminClient>,
  accessToken: string
): Promise<AdminResult> {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Nejste přihlášeni." };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.email) {
    return { ok: false, status: 401, error: "Neplatná session." };
  }

  if (!isPlatformAdminEmail(userData.user.email)) {
    // Zamítnutý pokus přihlášeného (ale ne-admin) uživatele o admin API —
    // logováno centrálně tady, ať to platí pro každý budoucí /api/admin/*
    // endpoint automaticky, ne jen pro cashflow.
    await admin.from("vpc_audit_log").insert({
      actor_type: "platform_admin",
      actor_id: userData.user.id,
      action: "admin.access_rejected",
      target_table: "admin_api",
      target_id: userData.user.id,
      after_state: { email: userData.user.email },
    });
    return { ok: false, status: 403, error: "Nemáte oprávnění k tomuto rozhraní." };
  }

  return { ok: true, email: userData.user.email };
}
