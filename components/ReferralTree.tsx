"use client";

import { useMemo, useState } from "react";

export type ReferralTreeRow = {
  end_user_id: string;
  referrer_end_user_id: string | null;
  depth: number;
  sort_key: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  direct_count: number;
  level_name: string | null;
  level_threshold: number | null;
};

function displayName(row: ReferralTreeRow): string {
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ");
  return full || row.email || row.phone || "Bez jména";
}

// sort_key je "000001.000002.000001" — nuly jsou tam jen kvůli textovému
// ORDER BY v RPC, ne kvůli zobrazení. Zobrazované číslo je to samé bez
// paddingu, žádný samostatný přepočet na klientovi není potřeba.
function displayNumber(sortKey: string): string {
  return sortKey
    .split(".")
    .map((segment) => parseInt(segment, 10))
    .join(".");
}

// Poslední segment sort_key = pořadí uzlu mezi jeho sourozenci (přesně to,
// co RPC počítá přes row_number() PARTITION BY referrer).
function siblingRank(row: ReferralTreeRow): number {
  const segments = row.sort_key.split(".");
  return parseInt(segments[segments.length - 1], 10);
}

const LINE_STYLE = { background: "var(--line-strong)" };

// Kořeny (depth 0) rozbalené defaultně, všechno hlouběji sbalené — viz
// plán Fáze 3. Řádky jsou už od RPC seřazené pre-order podle sort_key,
// takže stačí filtrovat viditelnost podle řetězce předků v `expanded`.
export function ReferralTree({ rows }: { rows: ReferralTreeRow[] }) {
  const rowsById = useMemo(() => {
    const map = new Map<string, ReferralTreeRow>();
    for (const row of rows) map.set(row.end_user_id, row);
    return map;
  }, [rows]);

  const parentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of rows) map.set(row.end_user_id, row.referrer_end_user_id);
    return map;
  }, [rows]);

  const childrenCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.referrer_end_user_id) continue;
      map.set(row.referrer_end_user_id, (map.get(row.referrer_end_user_id) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  // Je uzel poslední mezi svými sourozenci? Určuje, jestli se pod ním
  // svislá čára zastaví (└) nebo pokračuje dál k dalšímu sourozenci (├).
  // U kořenů (bez referrera) se nepoužívá — kořeny žádnou linku nemají.
  function isLastChild(row: ReferralTreeRow): boolean {
    if (!row.referrer_end_user_id) return true;
    const total = childrenCount.get(row.referrer_end_user_id) ?? 1;
    return siblingRank(row) === total;
  }

  // Řetězec předků od kořene po přímého rodiče (kořen na indexu 0).
  function ancestorChain(row: ReferralTreeRow): ReferralTreeRow[] {
    const chain: ReferralTreeRow[] = [];
    let current = row.referrer_end_user_id;
    while (current) {
      const parentRow = rowsById.get(current);
      if (!parentRow) break;
      chain.unshift(parentRow);
      current = parentRow.referrer_end_user_id;
    }
    return chain;
  }

  // Průchozí vodítka pro předky MEZI kořenem a přímým rodičem (kořen sám
  // žádnou linku nenese, proto se ancestorChain[0] přeskakuje) — svislá
  // čára na dané úrovni pokračuje, jen když ten předek ještě není
  // poslední ve svých sourozencích.
  function ancestorGuides(row: ReferralTreeRow): boolean[] {
    return ancestorChain(row)
      .slice(1)
      .map((ancestor) => !isLastChild(ancestor));
  }

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.depth === 0).map((r) => r.end_user_id))
  );

  function isVisible(row: ReferralTreeRow): boolean {
    let current = row.referrer_end_user_id;
    while (current) {
      if (!expanded.has(current)) return false;
      current = parentMap.get(current) ?? null;
    }
    return true;
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
        Zatím žádná pozvánková aktivita.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => {
        if (!isVisible(row)) return null;
        const hasChildren = (childrenCount.get(row.end_user_id) ?? 0) > 0;
        const isExpanded = expanded.has(row.end_user_id);
        const guides = row.depth > 0 ? ancestorGuides(row) : [];

        return (
          <div key={row.end_user_id} className="flex items-stretch text-[13px]">
            {guides.map((showLine, i) => (
              <div key={i} className="relative w-5 flex-shrink-0">
                {showLine && (
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={LINE_STYLE} />
                )}
              </div>
            ))}

            {row.depth > 0 && (
              <div className="relative w-5 flex-shrink-0">
                <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2" style={LINE_STYLE} />
                {!isLastChild(row) && (
                  <div className="absolute bottom-0 left-1/2 top-1/2 w-px -translate-x-1/2" style={LINE_STYLE} />
                )}
                <div className="absolute left-1/2 top-1/2 h-px w-2.5" style={LINE_STYLE} />
              </div>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-panel2">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(row.end_user_id)}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-ink-faint"
                  aria-label={isExpanded ? "Sbalit" : "Rozbalit"}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-4 flex-shrink-0" />
              )}

              <span className="flex-shrink-0 font-mono text-[11px] text-ink-faint">
                {displayNumber(row.sort_key)}
              </span>

              <span className="flex-1 truncate text-ink">{displayName(row)}</span>

              {row.level_name && <span className="badge">{row.level_name}</span>}

              <span className="flex-shrink-0 text-[11px] text-ink-faint">{row.direct_count} přímých pozvání</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
