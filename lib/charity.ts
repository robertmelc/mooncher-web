import { randomBytes, createHash } from "crypto";

// Charitativní vrstva — vlastní, oddělené jmenné prostory (chr_ tabulky),
// nesahá do jádra platformy (vpc_). Jediná výjimka je čtení z existujícího
// vpc_admin_draws (obecné losovací jádro, použitelné i pro jiné klienty),
// nikdy zápis do něj. Viz konverzace k výhernímu listu, srpen 2026.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function generateListNumber(): string {
  return `WIN-${randomCode(6)}`;
}

export function generateOtpCode(): string {
  // 6místný číselný kód — čitelný na SMS, dost prostoru (1e6 kombinací)
  // spolu s 5pokusovým limitem a krátkou expirací, ať brute-force nemá šanci.
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateOtpId(): string {
  return randomBytes(16).toString("hex");
}

export type TicketStatus = "voided" | "claimed" | "expired" | "pending";

// Stav se nikde neukládá na chr_winning_tickets — dopočítává se vždy
// z toho, co je skutečně pravda (voided_at, existence nezamítnutého
// claimu, lhůta). Stejná filozofie jako zůstatek vouchru nebo referral
// úroveň jinde v týhle appce — jeden zdroj pravdy, žádné riziko rozjetí.
export function deriveTicketStatus(ticket: {
  voided_at: string | null;
  claim_deadline: string;
}, hasActiveClaim: boolean): TicketStatus {
  if (ticket.voided_at) return "voided";
  if (hasActiveClaim) return "claimed";
  if (new Date(ticket.claim_deadline) < new Date()) return "expired";
  return "pending";
}
