"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type ShellProps = {
  title: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

// Sdílené jádro pro BusinessShell/AdminShell — obě obrazovky mají identický
// layout (header + boční nav + obsah), liší se jen tím, který sidebar
// vykreslí. Hamburger/drawer/backdrop stav je tu na jednom místě, ne
// duplikovaný ve dvou souborech (viz konverzace k responzivitě /business a /admin).
export function Shell({ title, sidebar, children }: ShellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex items-center gap-3 border-b border-line pb-4">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label="Otevřít menu"
            className="flex h-8 w-8 flex-shrink-0 flex-col items-center justify-center gap-[3px] rounded-sm border border-line-strong bg-panel2 md:hidden"
          >
            <span className="h-[2px] w-4 rounded-full bg-ink" />
            <span className="h-[2px] w-4 rounded-full bg-ink" />
            <span className="h-[2px] w-4 rounded-full bg-ink" />
          </button>
          <h1 className="font-display text-lg font-bold tracking-tight">{title}</h1>
        </header>

        <div className="flex gap-6">
          {isOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/55 md:hidden"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
          )}

          <div
            className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto bg-void p-5 shadow-2xl transition-transform duration-200 ease-in-out md:static md:z-auto md:w-44 md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none ${
              isOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            {sidebar}
          </div>

          <div className="flex flex-1 flex-col gap-4">{children}</div>
        </div>
      </div>
    </main>
  );
}
