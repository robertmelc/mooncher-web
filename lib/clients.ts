const STRIPE_CONNECT_STATUS_LABELS: Record<string, string> = {
  not_started: "Nepropojeno",
  onboarding: "Probíhá propojení",
  active: "Propojeno",
  restricted: "Omezeno",
};

export function stripeConnectStatusLabel(status: string): string {
  return STRIPE_CONNECT_STATUS_LABELS[status] ?? status;
}
