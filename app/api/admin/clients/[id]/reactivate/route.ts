import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: client, error: clientError } = await admin
    .from("vpc_clients")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Klient nenalezen." }, { status: 404 });
  }
  if (client.status !== "suspended") {
    return NextResponse.json(
      { ok: false, error: "Reaktivovat lze jen klienta ve stavu 'suspended'." },
      { status: 409 }
    );
  }

  // Podle B2 §5 reaktivace NEobnovuje programy zpátky na active — kaskáda
  // funguje jen jedním směrem (suspend → pauza). Obnovení konkrétního
  // programu je vědomý krok klienta/operátora, ne automatika.
  const { error: reactivateError } = await admin
    .from("vpc_clients")
    .update({ status: "active" })
    .eq("id", params.id);

  if (reactivateError) {
    return NextResponse.json({ ok: false, error: reactivateError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.client_reactivated",
    target_table: "vpc_clients",
    target_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
