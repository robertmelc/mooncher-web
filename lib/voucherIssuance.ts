import { randomUUID, createHash } from "crypto";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function generateVoucherCode(): string {
  return `GIFT-${randomCode(6)}`;
}

export function generateMultiIssuerVoucherCode(): string {
  return `MULTI-${randomCode(6)}`;
}

// qr_payload/qr_signature zatím BEZ reálného HMAC podpisu se secret_key
// z Supabase Vault (B4 §3) — ta infrastruktura nikde v appce neexistuje,
// stejný stav jako aktivační token (raw voucher.id) a POS lookup/redeem,
// co qr_signature vůbec nekontrolují. Viz HARDENING.md.
export function generateNewVoucherId(): string {
  return randomUUID();
}

export function placeholderQrSignature(payload: string): string {
  return createHash("sha256").update(`unsigned:${payload}`).digest("hex");
}
