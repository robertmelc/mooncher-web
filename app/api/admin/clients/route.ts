import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: clients, error } = await admin
    .from("vpc_clients")
    .select("id, name, status, stripe_connect_status")
    .order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, clients: clients ?? [] });
}
