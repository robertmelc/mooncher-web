const PROGRAM_STATUS_LABELS: Record<string, string> = {
  draft: "Koncept",
  active: "Aktivní",
  paused: "Pozastaveno",
  retired: "Ukončeno",
};

export function programStatusLabel(status: string): string {
  return PROGRAM_STATUS_LABELS[status] ?? status;
}
