import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

// Viz komentář v lib/business-auth.ts — proč tenhle lookup jde přes
// service roli, a co je skutečné řešení pro hardening fázi.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: client, error: clientError } = await admin
    .from("vpc_clients")
    .select("name, stripe_connect_status")
    .eq("id", operator.clientId)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Klient nenalezen." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, role: operator.role, client });
}
