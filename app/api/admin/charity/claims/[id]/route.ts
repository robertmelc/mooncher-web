import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Označí nárok jako vyplacený, nebo ho zamítne — výplata samotná probíhá
// mimo appku (převod z účtu nadace), tohle jen eviduje výsledek. Po
// zamítnutí zůstává výherce moci nárok uplatnit znovu (jiný, nový claim
// řádek) — částečný unikátní index (chr_payout_claims_one_active) to
// dovolí, protože ignoruje zamítnuté řádky.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  let body: { action?: "paid" | "rejected"; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (body.action !== "paid" && body.action !== "rejected") {
    return NextResponse.json({ ok: false, error: "Neplatná akce." }, { status: 400 });
  }

  const { data: claim, error: claimError } = await admin
    .from("chr_payout_claims")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ ok: false, error: claimError.message }, { status: 500 });
  }
  if (!claim) {
    return NextResponse.json({ ok: false, error: "Nárok nenalezen." }, { status: 404 });
  }
  if (claim.status !== "pending") {
    return NextResponse.json({ ok: false, error: "Nárok už je vyřízený." }, { status: 409 });
  }

  const update =
    body.action === "paid"
      ? { status: "paid", paid_at: new Date().toISOString(), paid_by_email: result.email }
      : {
          status: "rejected",
          rejected_at: new Date().toISOString(),
          rejected_by_email: result.email,
          rejected_reason: body.reason?.trim() || null,
        };

  const { error: updateError } = await admin.from("chr_payout_claims").update(update).eq("id", params.id);
  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: body.action === "paid" ? "charity.claim_marked_paid" : "charity.claim_rejected",
    target_table: "chr_payout_claims",
    target_id: params.id,
    after_state: update,
  });

  return NextResponse.json({ ok: true });
}
