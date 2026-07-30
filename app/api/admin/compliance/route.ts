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

  // Audit log i na zobrazení — LNE compliance data napříč klienty je
  // právně citlivá metrika, stejná úvaha jako u admin.cashflow_viewed (adm-1).
  const { data: userData } = await admin.auth.getUser(accessToken);
  const adminUserId = userData.user?.id ?? null;
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: adminUserId,
    action: "admin.compliance_viewed",
    target_table: "vpc_compliance_volume_snapshots",
    target_id: adminUserId,
  });

  const { data: clients, error: clientsError } = await admin
    .from("vpc_clients")
    .select("id, name")
    .order("name");

  if (clientsError) {
    return NextResponse.json({ ok: false, error: clientsError.message }, { status: 500 });
  }

  // Tabulku plní denní Edge Function, kterou jsme zatím nepostavili
  // (HARDENING.md #5) — dotaz je ale napsaný na skutečnou tabulku, ne
  // natvrdo prázdný výstup, takže jakmile job začne zapisovat, obrazovka
  // začne ukazovat reálná čísla bez další úpravy kódu.
  const { data: snapshots, error: snapshotsError } = await admin
    .from("vpc_compliance_volume_snapshots")
    .select("client_id, threshold_pct, computed_at")
    .order("computed_at", { ascending: false });

  if (snapshotsError) {
    return NextResponse.json({ ok: false, error: snapshotsError.message }, { status: 500 });
  }

  const latestByClient = new Map<string, number>();
  for (const s of snapshots ?? []) {
    if (!latestByClient.has(s.client_id)) {
      latestByClient.set(s.client_id, Number(s.threshold_pct));
    }
  }

  const rows = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    thresholdPct: latestByClient.get(c.id) ?? null,
  }));

  return NextResponse.json({ ok: true, clients: rows });
}
