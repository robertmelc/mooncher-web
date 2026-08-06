import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveTicketStatus } from "@/lib/charity";

// Bez tohohle by Next.js App Router tuhle GET routu (nečte žádné hlavičky/
// cookies) považoval za staticky cachovatelnou a "zamrzl" by první odpověď
// navěky — objeveno při ověřování stavu "voided" po zneplatnění listu.
export const dynamic = "force-dynamic";

type TicketRow = {
  id: string;
  list_number: string;
  target_phone: string;
  result_number: string;
  place: number | null;
  prize_amount: number;
  currency: string;
  amount_is_net: boolean;
  tax_withheld: number | null;
  claim_deadline: string;
  voided_at: string | null;
  created_at: string;
  client: { name: string } | null;
  admin_draw: { seed: string; result_hash: string; created_at: string } | null;
};

// Veřejný náhled výherního listu — bez přihlášení, chráněný jen
// neuhodnutelností UUID (skutečné uplatnění nároku navíc vyžaduje SMS
// kód na target_phone, viz /api/win/[id]/claim). Telefon se tu záměrně
// nevrací celý, jen poslední čtyři číslice, ať appka neprozrazuje víc,
// než kolik komukoliv s odkazem náleží vidět.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("chr_winning_tickets")
    .select(
      `id, list_number, target_phone, result_number, place, prize_amount, currency,
       amount_is_net, tax_withheld, claim_deadline, voided_at, created_at,
       client:vpc_clients ( name ),
       admin_draw:vpc_admin_draws ( seed, result_hash, created_at )`
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Výherní list nenalezen." }, { status: 404 });
  }

  const ticket = data as unknown as TicketRow;

  const { count: activeClaimCount } = await admin
    .from("chr_payout_claims")
    .select("id", { count: "exact", head: true })
    .eq("winning_ticket_id", ticket.id)
    .neq("status", "rejected");

  const status = deriveTicketStatus(ticket, (activeClaimCount ?? 0) > 0);
  const phoneLastFour = ticket.target_phone.slice(-4);

  return NextResponse.json({
    ok: true,
    ticket: {
      listNumber: ticket.list_number,
      resultNumber: ticket.result_number,
      place: ticket.place,
      prizeAmount: ticket.prize_amount,
      currency: ticket.currency,
      amountIsNet: ticket.amount_is_net,
      taxWithheld: ticket.tax_withheld,
      claimDeadline: ticket.claim_deadline,
      clientName: ticket.client?.name ?? "",
      drawDate: ticket.admin_draw?.created_at ?? ticket.created_at,
      seed: ticket.admin_draw?.seed ?? "",
      resultHash: ticket.admin_draw?.result_hash ?? "",
      phoneLastFour,
      status,
    },
  });
}
