import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

// Zneplatní výherní list — jediná nevratná operace v týhle vrstvě
// (vydání peněz se nedělá "omylem zpátky"), viz konverzace. Vyžaduje
// důvod, ať zůstane v audit logu doložitelné, proč byl list zrušen.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (!body.reason || !body.reason.trim()) {
    return NextResponse.json({ ok: false, error: "Zadejte důvod zneplatnění." }, { status: 400 });
  }

  const { data: ticket, error: ticketError } = await admin
    .from("chr_winning_tickets")
    .select("id, voided_at")
    .eq("id", params.id)
    .maybeSingle();

  if (ticketError) {
    return NextResponse.json({ ok: false, error: ticketError.message }, { status: 500 });
  }
  if (!ticket) {
    return NextResponse.json({ ok: false, error: "Výherní list nenalezen." }, { status: 404 });
  }
  if (ticket.voided_at) {
    return NextResponse.json({ ok: false, error: "List už je zneplatněný." }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("chr_winning_tickets")
    .update({
      voided_at: new Date().toISOString(),
      voided_reason: body.reason.trim(),
      voided_by_email: result.email,
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "charity.winning_ticket_voided",
    target_table: "chr_winning_tickets",
    target_id: params.id,
    after_state: { reason: body.reason.trim() },
  });

  return NextResponse.json({ ok: true });
}
