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
  if (client.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "Suspendovat lze jen klienta ve stavu 'active'." },
      { status: 409 }
    );
  }

  // Kaskáda z B2 §5: nejdřív pozastavit programy, teprve pak přepnout klienta
  // na suspended. V tomhle pořadí je selhání prvního kroku bezpečné (klient
  // zůstane active se svými programy beze změny, jde to zopakovat) — obráceně
  // by selhání druhého kroku mohlo nechat suspendovaného klienta s pořád
  // aktivními programy, což je stav, kterému má kaskáda zabránit. Obě
  // operace jsou navíc idempotentní (WHERE status='active'), takže
  // opakování po částečném selhání nic nerozbije.
  const { data: pausedPrograms, error: pauseError } = await admin
    .from("vpc_voucher_programs")
    .update({ status: "paused" })
    .eq("client_id", params.id)
    .eq("status", "active")
    .select("id");

  if (pauseError) {
    return NextResponse.json({ ok: false, error: pauseError.message }, { status: 500 });
  }

  const { error: suspendError } = await admin
    .from("vpc_clients")
    .update({ status: "suspended" })
    .eq("id", params.id);

  if (suspendError) {
    return NextResponse.json({ ok: false, error: suspendError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.client_suspended",
    target_table: "vpc_clients",
    target_id: params.id,
    after_state: { pausedProgramIds: (pausedPrograms ?? []).map((p) => p.id) },
  });

  return NextResponse.json({ ok: true });
}
