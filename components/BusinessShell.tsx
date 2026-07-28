import { BusinessSidebar } from "@/components/BusinessSidebar";

type BusinessShellProps = {
  title: string;
  children: React.ReactNode;
};

export function BusinessShell({ title, children }: BusinessShellProps) {
  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="border-b border-line pb-4">
          <h1 className="font-display text-lg font-bold tracking-tight">{title}</h1>
        </header>
        <div className="flex gap-6">
          <BusinessSidebar />
          <div className="flex flex-1 flex-col gap-4">{children}</div>
        </div>
      </div>
    </main>
  );
}
