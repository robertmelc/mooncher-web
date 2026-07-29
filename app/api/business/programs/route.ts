import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

// Viz komentář v lib/business-auth.ts — proč tohle jede přes service
// roli místo přímého klientského dotazu.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: programs, error: programsError } = await admin
    .from("vpc_voucher_programs")
    .select("id, name, voucher_type, status, currency, network_scope, design_config, created_at")
    .eq("client_id", operator.clientId)
    .order("created_at", { ascending: false });

  if (programsError) {
    return NextResponse.json({ ok: false, error: programsError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, programs: programs ?? [] });
}
