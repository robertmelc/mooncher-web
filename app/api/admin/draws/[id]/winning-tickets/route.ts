import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { generateListNumber } from "@/lib/charity";

// Vydá výherní list navázaný na konkrétní kolo losování (vpc_admin_draws) —
// čte z něj result_number, ale nikdy do něj nezapisuje. result_number/place
// se na chr_winning_tickets kopírují záměrně (jedno kolo může mít víc
// výherců, jedno pole result_number na to nestačí), viz HARDENING/konverzace.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: draw, error: drawError } = await admin
    .from("vpc_admin_draws")
    .select("id, result_number")
    .eq("id", params.id)
    .maybeSingle();

  if (drawError) {
    return NextResponse.json({ ok: false, error: drawError.message }, { status: 500 });
  }
  if (!draw) {
    return NextResponse.json({ ok: false, error: "Losování nenalezeno." }, { status: 404 });
  }

  let body: {
    clientId?: string;
    targetPhone?: string;
    place?: number;
    prizeAmount?: number;
    amountIsNet?: boolean;
    taxWithheld?: number;
    claimDeadline?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { clientId, targetPhone, place, prizeAmount, amountIsNet, taxWithheld, claimDeadline } = body;

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Vyberte klienta." }, { status: 400 });
  }
  if (!targetPhone || !targetPhone.trim()) {
    return NextResponse.json({ ok: false, error: "Zadejte telefon výherce." }, { status: 400 });
  }
  if (typeof prizeAmount !== "number" || prizeAmount <= 0) {
    return NextResponse.json({ ok: false, error: "Zadejte kladnou částku výhry." }, { status: 400 });
  }
  if (typeof amountIsNet !== "boolean") {
    return NextResponse.json({ ok: false, error: "Určete, jestli je částka hrubá, nebo čistá." }, { status: 400 });
  }
  if (!claimDeadline) {
    return NextResponse.json({ ok: false, error: "Zadejte lhůtu pro uplatnění nároku." }, { status: 400 });
  }

  const { data: client, error: clientError } = await admin
    .from("vpc_clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) {
    return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Klient nenalezen." }, { status: 404 });
  }

  const { data: ticket, error: insertError } = await admin
    .from("chr_winning_tickets")
    .insert({
      admin_draw_id: draw.id,
      client_id: clientId,
      list_number: generateListNumber(),
      target_phone: targetPhone.trim(),
      result_number: String(draw.result_number),
      place: typeof place === "number" ? place : null,
      prize_amount: prizeAmount,
      amount_is_net: amountIsNet,
      tax_withheld: typeof taxWithheld === "number" ? taxWithheld : null,
      claim_deadline: claimDeadline,
      created_by_email: result.email,
    })
    .select("id, list_number")
    .single();

  if (insertError || !ticket) {
    return NextResponse.json(
      { ok: false, error: insertError?.message ?? "Vydání výherního listu se nezdařilo." },
      { status: 500 }
    );
  }

  const { data: userData } = await admin.auth.getUser(accessToken);

  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "charity.winning_ticket_issued",
    target_table: "chr_winning_tickets",
    target_id: ticket.id,
    after_state: { adminDrawId: draw.id, clientId, prizeAmount, amountIsNet },
  });

  return NextResponse.json({ ok: true, ticketId: ticket.id, listNumber: ticket.list_number });
}
