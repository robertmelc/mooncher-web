"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Přehled", href: "/business" },
  { label: "Programy", href: "/business/programs" },
  { label: "Šablony", href: "/business/templates" },
  { label: "POS", href: "/business/pos" },
  { label: "Reporty", href: "/business/reports" },
];

export function BusinessSidebar() {
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
