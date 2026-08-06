import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { deriveTicketStatus } from "@/lib/charity";

type TicketRow = {
  id: string;
  list_number: string;
  target_phone: string;
  result_number: string;
  place: number | null;
  prize_amount: number;
  currency: string;
  claim_deadline: string;
  voided_at: string | null;
  created_at: string;
  client: { name: string } | null;
};

type ClaimRow = {
  id: string;
  winning_ticket_id: string;
  full_name: string;
  bank_account: string;
  phone: string;
  status: string;
  submitted_at: string;
};

// Přehled výherních listů pro platform_admin — jediné místo, co smí číst
// chr_payout_claims (číslo účtu). client_operator sem přístup nemá.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: ticketsData, error: ticketsError } = await admin
    .from("chr_winning_tickets")
    .select(
      `id, list_number, target_phone, result_number, place, prize_amount, currency,
       claim_deadline, voided_at, created_at, client:vpc_clients ( name )`
    )
    .order("created_at", { ascending: false });

  if (ticketsError) {
    return NextResponse.json({ ok: false, error: ticketsError.message }, { status: 500 });
  }

  const tickets = (ticketsData ?? []) as unknown as TicketRow[];
  const ticketIds = tickets.map((t) => t.id);

  const { data: claimsData, error: claimsError } = await admin
    .from("chr_payout_claims")
    .select("id, winning_ticket_id, full_name, bank_account, phone, status, submitted_at")
    .in("winning_ticket_id", ticketIds.length ? ticketIds : ["00000000-0000-0000-0000-000000000000"])
    .order("submitted_at", { ascending: false });

  if (claimsError) {
    return NextResponse.json({ ok: false, error: claimsError.message }, { status: 500 });
  }

  const claims = (claimsData ?? []) as ClaimRow[];
  const claimsByTicket = new Map<string, ClaimRow[]>();
  for (const claim of claims) {
    const list = claimsByTicket.get(claim.winning_ticket_id) ?? [];
    list.push(claim);
    claimsByTicket.set(claim.winning_ticket_id, list);
  }

  const result_ = tickets.map((ticket) => {
    const ticketClaims = claimsByTicket.get(ticket.id) ?? [];
    const activeClaim = ticketClaims.find((c) => c.status !== "rejected") ?? null;
    const status = deriveTicketStatus(ticket, !!activeClaim);

    return {
      id: ticket.id,
      listNumber: ticket.list_number,
      targetPhone: ticket.target_phone,
      resultNumber: ticket.result_number,
      place: ticket.place,
      prizeAmount: ticket.prize_amount,
      currency: ticket.currency,
      claimDeadline: ticket.claim_deadline,
      clientName: ticket.client?.name ?? "",
      createdAt: ticket.created_at,
      status,
      claims: ticketClaims,
    };
  });

  return NextResponse.json({ ok: true, tickets: result_ });
}
