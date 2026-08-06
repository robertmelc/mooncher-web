import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveTicketStatus, hashOtpCode } from "@/lib/charity";

const MAX_ATTEMPTS = 5;

// Dokončí uplatnění nároku — vyžaduje platný, nevypršelý, nespotřebovaný
// SMS kód (viz /api/win/[id]/send-code). Kód je jednorázový (consumed_at
// se nastaví hned po úspěšném ověření) a má limit 5 pokusů, po kterém se
// zneplatní a appka vynutí vyžádání nového — bez tohohle by bylo ověření
// jen dekorace, viz konverzace.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  let body: { code?: string; fullName?: string; bankAccount?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const code = body.code?.trim();
  const fullName = body.fullName?.trim();
  const bankAccount = body.bankAccount?.trim();
  const phone = body.phone?.trim();

  if (!code || !fullName || !bankAccount || !phone) {
    return NextResponse.json({ ok: false, error: "Vyplňte prosím všechna pole." }, { status: 400 });
  }

  const { data: ticket, error: ticketError } = await admin
    .from("chr_winning_tickets")
    .select("id, voided_at, claim_deadline")
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
    return NextResponse.json({ ok: false, error: "U tohoto listu už nelze nárok uplatnit." }, { status: 409 });
  }

  const { data: otp, error: otpError } = await admin
    .from("chr_claim_otps")
    .select("id, code_hash, attempts")
    .eq("winning_ticket_id", ticket.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpError) {
    return NextResponse.json({ ok: false, error: otpError.message }, { status: 500 });
  }
  if (!otp) {
    return NextResponse.json({ ok: false, error: "Nejdřív si vyžádejte ověřovací kód." }, { status: 400 });
  }

  if (hashOtpCode(code) !== otp.code_hash) {
    const nextAttempts = otp.attempts + 1;
    const exhausted = nextAttempts >= MAX_ATTEMPTS;
    await admin
      .from("chr_claim_otps")
      .update({ attempts: nextAttempts, ...(exhausted ? { consumed_at: new Date().toISOString() } : {}) })
      .eq("id", otp.id);

    return NextResponse.json(
      {
        ok: false,
        error: exhausted
          ? "Příliš mnoho nesprávných pokusů. Vyžádejte si prosím nový kód."
          : "Nesprávný kód.",
      },
      { status: 400 }
    );
  }

  await admin.from("chr_claim_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

  const { data: claim, error: claimError } = await admin
    .from("chr_payout_claims")
    .insert({
      winning_ticket_id: ticket.id,
      full_name: fullName,
      bank_account: bankAccount,
      phone,
    })
    .select("id")
    .single();

  if (claimError || !claim) {
    // Souběh — mezitím vznikl jiný nezamítnutý claim (chr_payout_claims_one_active).
    if (claimError?.code === "23505") {
      return NextResponse.json({ ok: false, error: "Nárok už byl uplatněn." }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: claimError?.message ?? "Odeslání se nezdařilo." },
      { status: 500 }
    );
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "end_user",
    actor_id: null,
    action: "charity.payout_claim_submitted",
    target_table: "chr_payout_claims",
    target_id: claim.id,
    after_state: { winningTicketId: ticket.id },
  });

  return NextResponse.json({ ok: true });
}
