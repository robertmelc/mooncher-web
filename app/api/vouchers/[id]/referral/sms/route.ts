import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveContext } from "@/lib/voucherReferralContext";
import { isValidPhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms";

// Pošle SMS pozvánku na konkrétní telefon a založí sledovací řádek —
// odkaz nese ?invite=<id>, přes které se pozdější join spáruje s touhle
// konkrétní pozvánkou (viz app/api/referral/[code]/route.ts). Chyba
// odeslání se appce vrací rovnou, ne jako tichý best-effort — je to
// hlavní akce, kterou uživatel vědomě spustil kliknutím.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const ctx = await resolveContext(admin, req, params.id);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ ok: false, error: "Zadejte platné telefonní číslo." }, { status: 400 });
  }

  // SMS lze poslat jen na existující pozvánkový kód — appka ho nezakládá
  // tady, jen ho použije (musí už existovat z "Získat pozvánkový odkaz").
  const { data: code } = await admin
    .from("vpc_referral_codes")
    .select("id")
    .eq("end_user_id", ctx.endUserId)
    .eq("voucher_program_id", ctx.programId)
    .maybeSingle();

  if (!code) {
    return NextResponse.json({ ok: false, error: "Nejdřív si vytvořte pozvánkový odkaz." }, { status: 400 });
  }

  const { data: client } = await admin
    .from("vpc_clients")
    .select("name")
    .eq("id", ctx.clientId)
    .maybeSingle();

  const { data: invite, error: insertError } = await admin
    .from("vpc_referral_invites")
    .insert({ referral_code_id: code.id, phone })
    .select("id")
    .single();

  if (insertError || !invite) {
    return NextResponse.json(
      { ok: false, error: insertError?.message ?? "Nepodařilo se založit pozvánku." },
      { status: 500 }
    );
  }

  const inviteUrl = `${req.nextUrl.origin}/app/join/${code.id}?invite=${invite.id}`;
  const message = `Máš pozvánku do ${client?.name ?? "klubu"}! Otevři: ${inviteUrl}`;

  try {
    await sendSms(phone, message);
  } catch (err) {
    // Odeslání selhalo — smaže se i sledovací řádek, ať appka netvrdí,
    // že SMS odešla, když neodešla.
    await admin.from("vpc_referral_invites").delete().eq("id", invite.id);
    const error = err instanceof Error ? err.message : "Odeslání SMS se nezdařilo.";
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, inviteId: invite.id });
}
