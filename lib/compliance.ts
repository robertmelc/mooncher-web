// threshold_pct přichází z vpc_compliance_volume_snapshots, kterou plní
// denní Edge Function (B1 §6) — ta zatím neexistuje (viz HARDENING.md #5),
// takže null je dnes jediná reálná hodnota. Logika níže je připravená na
// den, kdy job začne tabulku plnit, ne spekulativní kód navíc.

export function complianceLabel(thresholdPct: number | null): string {
  if (thresholdPct === null) return "Zatím nesledováno";
  return `${thresholdPct.toFixed(1)} %`;
}

export function complianceBadgeVariant(thresholdPct: number | null): "gray" | "danger" | "" {
  if (thresholdPct === null) return "gray";
  return thresholdPct >= 80 ? "danger" : "";
}
