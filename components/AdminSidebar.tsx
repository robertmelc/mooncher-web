"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Cashflow", href: "/admin" },
  { label: "Klienti", href: "/admin/clients" },
  { label: "Compliance", href: "/admin/compliance" },
  { label: "Šablony", href: "/admin/templates" },
  { label: "Losování", href: "/admin/draw" },
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
    </nav>
  );
}
