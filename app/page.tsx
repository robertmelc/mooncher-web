import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-24">
      <h1 className="text-3xl font-bold">Mooncher</h1>
      <p className="text-sm text-neutral-500">Kostra projektu — tři rozhraní podle B3</p>
      <nav className="flex gap-4">
        <Link href="/app" className="underline">/app (koncový uživatel)</Link>
        <Link href="/business" className="underline">/business (klient)</Link>
        <Link href="/admin" className="underline">/admin (platform admin)</Link>
      </nav>
    </main>
  );
}
