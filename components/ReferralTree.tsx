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

// Kořeny (depth 0) rozbalené defaultně, všechno hlouběji sbalené — viz
// plán Fáze 3. Řádky jsou už od RPC seřazené pre-order podle sort_key,
// takže stačí filtrovat viditelnost podle řetězce předků v `expanded`.
export function ReferralTree({ rows }: { rows: ReferralTreeRow[] }) {
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
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => {
        if (!isVisible(row)) return null;
        const hasChildren = (childrenCount.get(row.end_user_id) ?? 0) > 0;
        const isExpanded = expanded.has(row.end_user_id);

        return (
          <div
            key={row.end_user_id}
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-panel2"
            style={{ paddingLeft: row.depth * 20 + 8 }}
          >
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

            <span className="flex-1 truncate text-ink">{displayName(row)}</span>

            {row.level_name && <span className="badge">{row.level_name}</span>}

            <span className="flex-shrink-0 text-[11px] text-ink-faint">{row.direct_count} přímých pozvání</span>
          </div>
        );
      })}
    </div>
  );
}
