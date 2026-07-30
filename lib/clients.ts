const STRIPE_CONNECT_STATUS_LABELS: Record<string, string> = {
  not_started: "Nepropojeno",
  onboarding: "Probíhá propojení",
  active: "Propojeno",
  restricted: "Omezeno",
};

export function stripeConnectStatusLabel(status: string): string {
  return STRIPE_CONNECT_STATUS_LABELS[status] ?? status;
}

const CLIENT_STATUS_LABELS: Record<string, string> = {
  pending: "Čeká na aktivaci",
  active: "Aktivní",
  suspended: "Pozastaveno",
  closed: "Ukončeno",
};

export function clientStatusLabel(status: string): string {
  return CLIENT_STATUS_LABELS[status] ?? status;
}

// "gray" (neutrální/pending), "danger" (suspended/closed), nebo výchozí teal (active).
export function clientStatusBadgeVariant(status: string): "gray" | "danger" | "" {
  if (status === "pending") return "gray";
  if (status === "suspended" || status === "closed") return "danger";
  return "";
}
