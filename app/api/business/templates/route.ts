import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

// Viz HARDENING.md #1 — přímý klientský RLS dotaz jako client_operator
// tiše selhává (chybí Auth Hook), takže sdílené šablony operátor vidí,
// ale svoje vlastní exkluzivní ne. Řešeno service rolí, stejný vzorec
// jako app/api/business/programs/route.ts.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: templates, error: templatesError } = await admin
    .from("vpc_voucher_templates")
    .select("id, name, category, thumbnail_url, owner_client_id")
    .eq("is_active", true)
    .or(`owner_client_id.is.null,owner_client_id.eq.${operator.clientId}`)
    .order("created_at", { ascending: false });

  if (templatesError) {
    return NextResponse.json({ ok: false, error: templatesError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: templates ?? [] });
}
