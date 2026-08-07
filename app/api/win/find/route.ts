import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { deriveTicketStatus } from "@/lib/charity";
import { sendSms } from "@/lib/sms";

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// vpc_audit_log.target_id je uuid, ne text — telefon tam nejde uložit
// přímo. Skutečný klíč pro limiter je after_state.phone; target_id nese
// jen neutrální sentinel, ať projde NOT NULL/uuid omezením sloupce.
const NO_TARGET_SENTINEL = "00000000-0000-0000-0000-000000000000";

const GENERIC_RESPONSE = { ok: true, message: "Pokud k tomuto číslu výhra existuje, poslali jsme odkaz SMS." };

async function isRateLimited(admin: ReturnType<typeof createAdminClient>, phone: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("vpc_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "charity.ticket_resend_requested")
    .eq("after_state->>phone", phone)
    .gte("created_at", since);

  if (error) return false;
  return (count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS;
}

// Najde nevyzvednuté výherní listy podle telefonu a znovu na něj pošle
// odkaz SMS-kou. Odpověď appky je VŽDY stejná bez ohledu na to, jestli
// list existuje — jinak by tenhle endpoint byl nový způsob, jak zjistit,
// že pro dané číslo nějaká výhra existuje (viz konverzace). Stejný
// DB-backed limiter jako u aktivace vouchru (HARDENING #3) — 5 pokusů /
// 10 minut, tady podle telefonu, protože request nenese žádné jiné ID.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (!body.phone || !isValidPhone(body.phone)) {
    return NextResponse.json({ ok: false, error: "Zadejte platné telefonní číslo." }, { status: 400 });
  }

  const phone = normalizePhone(body.phone);

  if (await isRateLimited(admin, phone)) {
    return NextResponse.json(GENERIC_RESPONSE);
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "system",
    action: "charity.ticket_resend_requested",
    target_table: "chr_winning_tickets",
    target_id: NO_TARGET_SENTINEL,
    after_state: { phone },
  });

  const { data: tickets } = await admin
    .from("chr_winning_tickets")
    .select("id, voided_at, claim_deadline")
    .eq("target_phone", phone);

  if (tickets && tickets.length > 0) {
    const ticketIds = tickets.map((t) => t.id);
    const { data: claims } = await admin
      .from("chr_payout_claims")
      .select("winning_ticket_id")
      .in("winning_ticket_id", ticketIds)
      .neq("status", "rejected");

    const claimedIds = new Set((claims ?? []).map((c) => c.winning_ticket_id));

    for (const ticket of tickets) {
      const status = deriveTicketStatus(ticket, claimedIds.has(ticket.id));
      if (status !== "pending") continue;

      const url = `${req.nextUrl.origin}/app/win/${ticket.id}`;
      try {
        await sendSms(phone, `Máte nevyzvednutou výhru mooncher. Pokračujte zde: ${url}`);
      } catch {
        // Selhání SMS se záměrně neprojeví v odpovědi — jinak by rozlišitelnost
        // "existuje, ale nepodařilo se poslat" od "neexistuje" prozrazovala totéž,
        // čemu se celý tenhle endpoint snaží zabránit.
      }
    }
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
