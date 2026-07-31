import Link from "next/link";
import { MoonMark } from "@/components/MoonMark";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-24 text-center">
      <MoonMark size={44} />
      <h1 className="font-display text-2xl font-bold tracking-tight">Mooncher</h1>
      <p className="text-sm text-ink-dim">Kostra projektu — tři rozhraní podle B3</p>
      <nav className="flex flex-col gap-2">
        <Link href="/app" className="text-teal underline">/app (koncový uživatel)</Link>
        <Link href="/business" className="text-teal underline">/business (klient)</Link>
        <Link href="/admin" className="text-teal underline">/admin (platform admin)</Link>
      </nav>
    </main>
  );
}
