import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

// Viz HARDENING.md #1 a app/api/business/templates/route.ts — stejný důvod
// pro service roli místo přímého klientského dotazu.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: template, error: templateError } = await admin
    .from("vpc_voucher_templates")
    .select("id, name, category, front_layout, token_schema, owner_client_id")
    .eq("id", params.id)
    .maybeSingle();

  if (templateError) {
    return NextResponse.json({ ok: false, error: templateError.message }, { status: 500 });
  }

  // Vlastnictví — defense in depth: sdílená (owner_client_id null) nebo
  // vlastní exkluzivní šablona, jinak generická 404, ať neprozradíme
  // existenci cizí exkluzivní šablony.
  if (!template || (template.owner_client_id && template.owner_client_id !== operator.clientId)) {
    return NextResponse.json({ ok: false, error: "Šablona nenalezena." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, template });
}
