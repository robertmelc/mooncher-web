import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DOČASNÉ ŘEŠENÍ (viz konverzace k obrazovce biz-1, B4 §1.2):
 * RLS politika na vpc_client_users (vpc_is_client_operator_for) čte
 * client_id z JWT app_metadata — ten claim ale nikdy nevznikl, protože
 * nemáme Auth Hook, který by ho při přihlášení nastavil podle shody
 * e-mailu ve vpc_client_users. Bez toho RLS zamítne i dotaz "najdi svůj
 * vlastní řádek podle e-mailu" (kruhová závislost — ověřeno přímým
 * porovnáním service-role vs. anon dotazu a inspekcí app_metadata).
 *
 * Tenhle endpoint proto lookup dělá server-side přes service roli,
 * s e-mailem vzatým výhradně z ověřeného JWT (ne z těla requestu, ať
 * nejde dotazovat cizí e-mail).
 *
 * SKUTEČNÉ ŘEŠENÍ pro hardening fázi před ostrým nasazením: Supabase
 * Auth Hook (custom access token hook), který při vytvoření session
 * vloží client_id + role do app_metadata podle shody e-mailu ve
 * vpc_client_users. Tím by RLS politika z B4 konečně fungovala tak,
 * jak byla navržená, a tenhle Route Handler by šel zrušit ve prospěch
 * přímého klientského dotazu.
 */
export async function GET(req: NextRequest) {
  const admin = createAdminClient();

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Nejste přihlášeni." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  const { data: clientUser, error: clientUserError } = await admin
    .from("vpc_client_users")
    .select("role, client_id")
    .ilike("email", userData.user.email)
    .maybeSingle();

  if (clientUserError) {
    return NextResponse.json({ ok: false, error: clientUserError.message }, { status: 500 });
  }
  if (!clientUser) {
    return NextResponse.json({ ok: false, error: "Tento účet není napojený na žádného klienta." }, { status: 404 });
  }

  const { data: client, error: clientError } = await admin
    .from("vpc_clients")
    .select("name, stripe_connect_status")
    .eq("id", clientUser.client_id)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Klient nenalezen." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, role: clientUser.role, client });
}
