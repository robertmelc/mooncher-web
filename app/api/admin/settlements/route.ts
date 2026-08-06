import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Dluhy mezi spřízněnými firmami vzniklé doplácením u vícevydavatelských
// karet — "musí být dohledatelné, kdo komu kolik dluží" (viz konverzace).
// Jen platform_admin, ne client_operator — je to napříč firmami.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data, error } = await admin
    .from("vpc_inter_issuer_settlements")
    .select(
      `id, voucher_id, amount, status, created_at, settled_at, settled_by_email,
       creditor:vpc_clients!creditor_client_id ( name ),
       debtor:vpc_clients!debtor_client_id ( name ),
       voucher:vpc_vouchers ( code )`
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settlements: data ?? [] });
}
