import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Seznam vícevydavatelských programů pro vydávací formulář — správa
// samotných skupin/programů (zakládání nových) zatím nemá UI, řeší se
// SQL, viz konverzace. Tohle je jen čtení pro dropdown.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data, error } = await admin
    .from("vpc_multi_issuer_programs")
    .select(
      `id, name, currency,
       client_group:vpc_client_groups ( name ),
       members:vpc_multi_issuer_program_members (
         split_percent,
         voucher_program:vpc_voucher_programs ( id, name, client:vpc_clients ( id, name ) )
       )`
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, programs: data ?? [] });
}
