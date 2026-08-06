export type SplitMember = { voucherProgramId: string; splitPercent: number };
export type SplitResult = { voucherProgramId: string; amount: number };

// Rozpočítá total podle split_percent — poslední člen (v pořadí, v jakém
// appka pole dostane) dostane přesný zbytek do celkové částky místo
// nezávisle zaokrouhleného podílu, ať součet vždycky sedí do koruny na
// vydanou částku. Volající si pořadí určuje sám (appka ho nepřerovnává).
export function splitAmount(total: number, members: SplitMember[]): SplitResult[] {
  if (members.length === 0) return [];

  const results: SplitResult[] = [];
  let allocated = 0;

  for (let i = 0; i < members.length - 1; i++) {
    const share = Math.round((total * members[i].splitPercent) / 100);
    results.push({ voucherProgramId: members[i].voucherProgramId, amount: share });
    allocated += share;
  }

  const last = members[members.length - 1];
  results.push({ voucherProgramId: last.voucherProgramId, amount: total - allocated });
  return results;
}

// Součet split_percent napříč členy jednoho vpc_multi_issuer_programs musí
// dát 100 — databáze to cross-row CHECKem nehlídá (Postgres to neumí
// deklarativně), proto se ověřuje tady, při každém vydání. Viz komentář
// u vpc_multi_issuer_program_members v migraci.
export function splitPercentSumsTo100(members: { splitPercent: number }[]): boolean {
  const sum = members.reduce((acc, m) => acc + m.splitPercent, 0);
  return Math.abs(sum - 100) < 0.01;
}
