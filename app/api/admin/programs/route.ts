import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Stejný lehký vzorec jako clients/[id]/programs/route.ts — jen bez
// filtru na klienta, pro volbu "Všichni klienti" v app/admin/issue-voucher.
// Klientovo jméno se dotahuje jen kvůli seskupení/popisku v UI.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: programs, error } = await admin
    .from("vpc_voucher_programs")
    .select("id, name, status, currency, client_id, client:vpc_clients ( name )")
    .order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, programs: programs ?? [] });
}
