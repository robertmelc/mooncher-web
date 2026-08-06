import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Označí dluh mezi firmami jako vyrovnaný — skutečná úhrada probíhá mimo
// appku (převod mezi bankovními účty firem), appka ji jen eviduje, stejná
// filozofie jako u výplaty výherních listů v charitativní vrstvě.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: settlement, error: settlementError } = await admin
    .from("vpc_inter_issuer_settlements")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (settlementError) {
    return NextResponse.json({ ok: false, error: settlementError.message }, { status: 500 });
  }
  if (!settlement) {
    return NextResponse.json({ ok: false, error: "Dluh nenalezen." }, { status: 404 });
  }
  if (settlement.status !== "outstanding") {
    return NextResponse.json({ ok: false, error: "Dluh už je vyrovnaný." }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("vpc_inter_issuer_settlements")
    .update({ status: "settled", settled_at: new Date().toISOString(), settled_by_email: result.email })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: null,
    action: "inter_issuer_settlement.settled",
    target_table: "vpc_inter_issuer_settlements",
    target_id: params.id,
    after_state: { settledByEmail: result.email },
  });

  return NextResponse.json({ ok: true });
}
