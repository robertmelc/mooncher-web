const VERIFICATION_TIER_LABELS: Record<string, string> = {
  standard: "Neověřeno",
  eclipse_pending: "Čeká na ověření",
  eclipse: "Ověřeno",
};

export function verificationTierLabel(tier: string): string {
  return VERIFICATION_TIER_LABELS[tier] ?? tier;
}
