"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Cashflow", href: "/admin" },
  { label: "Klienti", href: "/admin/clients" },
  { label: "Compliance", href: "/admin/compliance" },
  { label: "Šablony", href: "/admin/templates" },
  { label: "Losování", href: "/admin/draw" },
  { label: "Síť", href: "/admin/referrals" },
  { label: "Vydat voucher", href: "/admin/issue-voucher" },
  { label: "Audit log", href: "/admin/audit-log" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-44 flex-shrink-0 flex-col gap-1 border-r border-line pr-4">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`rounded-sm px-3 py-2 text-[13px] font-semibold ${
            pathname === item.href ? "bg-teal-glow text-teal" : "text-ink-dim"
          }`}
        >
          {item.label}
        </Link>
      ))}
      {/* Odchod ze sekce, ne další stránka uvnitř ní — proto oddělené
          předělem a tlumenější barvou, ne v NAV_ITEMS. Bez podmínky role:
          i identita bez vpc_end_users řádku dostane na /app bezpečný
          prázdný stav ("Zatím tu nemáte žádný voucher."), ne chybu. */}
      <Link href="/app" className="mt-2 border-t border-line px-3 pt-3 text-[13px] font-semibold text-ink-faint">
        ‹ Zpět na můj účet
      </Link>
    </nav>
  );
}
