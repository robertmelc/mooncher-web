import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Lehký endpoint jen pro naplnění závislého <select> programů podle
// klienta (např. app/admin/issue-voucher) — záměrně oddělené od
// GET /api/admin/clients/[id], které je těžší (transakce, audit log) a
// samo se loguje jako "zobrazení detailu klienta". Volba klienta ve
// formuláři není totéž jako otevření jeho detailu.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: programs, error } = await admin
    .from("vpc_voucher_programs")
    .select("id, name, status, currency")
    .eq("client_id", params.id)
    .order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, programs: programs ?? [] });
}
