import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { sendSms } from "@/lib/sms";

// Pošle výherci SMS s odkazem na jeho výherní list — appka na tohle
// zatím nemá žádný jiný doručovací kanál (HARDENING #7), stejný GoSMS
// vzor jako u referral pozvánek.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: ticket, error: ticketError } = await admin
    .from("chr_winning_tickets")
    .select("id, target_phone, prize_amount, currency")
    .eq("id", params.id)
    .maybeSingle();

  if (ticketError) {
    return NextResponse.json({ ok: false, error: ticketError.message }, { status: 500 });
  }
  if (!ticket) {
    return NextResponse.json({ ok: false, error: "Výherní list nenalezen." }, { status: 404 });
  }

  const link = `${req.nextUrl.origin}/app/win/${ticket.id}`;

  try {
    await sendSms(ticket.target_phone, `Gratulujeme, vyhráli jste! Váš výherní list: ${link}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Odeslání SMS se nezdařilo.";
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
