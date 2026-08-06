import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveTicketStatus, generateOtpCode, hashOtpCode } from "@/lib/charity";
import { sendSms } from "@/lib/sms";

const OTP_TTL_MS = 10 * 60 * 1000;

// Pošle ověřovací SMS kód na target_phone — jediná ochrana nároku nad
// rámec neuhodnutelnosti UUID v odkazu (viz konverzace). Idempotentní
// vůči rychlému opakovanému klikání: pokud už existuje nevypršelý,
// nespotřebovaný kód, pošle appka jen informaci, ne novou SMS navíc.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: ticket, error: ticketError } = await admin
    .from("chr_winning_tickets")
    .select("id, target_phone, voided_at, claim_deadline")
    .eq("id", params.id)
    .maybeSingle();

  if (ticketError) {
    return NextResponse.json({ ok: false, error: ticketError.message }, { status: 500 });
  }
  if (!ticket) {
    return NextResponse.json({ ok: false, error: "Výherní list nenalezen." }, { status: 404 });
  }

  const { count: activeClaimCount } = await admin
    .from("chr_payout_claims")
    .select("id", { count: "exact", head: true })
    .eq("winning_ticket_id", ticket.id)
    .neq("status", "rejected");

  const status = deriveTicketStatus(ticket, (activeClaimCount ?? 0) > 0);
  if (status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "U tohoto listu už nelze o ověřovací kód požádat." },
      { status: 409 }
    );
  }

  const { data: existingOtp } = await admin
    .from("chr_claim_otps")
    .select("id, expires_at")
    .eq("winning_ticket_id", ticket.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingOtp) {
    return NextResponse.json({ ok: true, message: "Kód už byl odeslán, zkontrolujte SMS." });
  }

  const code = generateOtpCode();
  const { error: insertError } = await admin.from("chr_claim_otps").insert({
    winning_ticket_id: ticket.id,
    code_hash: hashOtpCode(code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  try {
    await sendSms(ticket.target_phone, `Váš ověřovací kód pro výherní list mooncher: ${code} (platí 10 minut).`);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Odeslání SMS se nezdařilo.";
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, message: "Ověřovací kód odeslán SMS." });
}
