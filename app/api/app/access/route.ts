import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import { resolveClientOperator } from "@/lib/business-auth";

// Pro přepínač rozhraní v /app/settings — jen "má tenhle přihlášený člověk
// i jinou roli (client_operator/platform_admin)?", ne skutečná autorizace.
// Záměrně beze audit-logu (viz lib/admin-auth.ts) — je to pasivní kontrola
// při každém otevření Nastavení, ne pokus o přístup k admin/business datům.
// Cílové /business a /admin si svoje resolveClientOperator()/resolveAdmin()
// dělají znovu a nezávisle při každém skutečném volání — tenhle endpoint
// jen rozhoduje, jestli se odkaz vůbec zobrazí.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  const isAdmin = isPlatformAdminEmail(userData.user.email);

  const operator = await resolveClientOperator(admin, accessToken);
  let isClientOperator = false;
  let clientName: string | null = null;

  if (operator.ok) {
    isClientOperator = true;
    const { data: client } = await admin.from("vpc_clients").select("name").eq("id", operator.clientId).maybeSingle();
    clientName = client?.name ?? null;
  }

  return NextResponse.json({ ok: true, isAdmin, isClientOperator, clientName });
}
