"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { TemplateForm, type TemplateFormValues } from "@/components/TemplateForm";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";

const EMPTY_VALUES: TemplateFormValues = {
  name: "",
  category: TEMPLATE_CATEGORIES[0],
  ownerClientId: "",
  frontLayout: "",
  backLayout: "",
  tokenSchemaText: "{}",
  thumbnailUrl: "",
  isActive: true,
};

export default function AdminNewTemplatePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    async function loadClients() {
      const res = await fetch("/api/admin/clients", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setClients(json.clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      }
    }

    loadClients();
  }, [session]);

  async function handleSubmit(values: TemplateFormValues) {
    if (!session) return { ok: false, error: "Nejste přihlášeni." };

    const res = await fetch("/api/admin/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        name: values.name,
        category: values.category,
        frontLayout: values.frontLayout,
        backLayout: values.backLayout,
        tokenSchema: JSON.parse(values.tokenSchemaText || "{}"),
        ownerClientId: values.ownerClientId || null,
        thumbnailUrl: values.thumbnailUrl || null,
      }),
    });
    const json = await res.json();

    if (res.ok) {
      router.push(`/admin/templates/${json.id}`);
      return { ok: true };
    }
    return { ok: false, error: json.error };
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Nahrát šablonu</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent("/admin/templates/new")}`}
              className="text-teal underline"
            >
              přihlásit se
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AdminShell title="Nahrát šablonu">
      {authLoading ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : (
        <TemplateForm
          mode="create"
          initialValues={EMPTY_VALUES}
          clients={clients}
          onSubmit={handleSubmit}
          submitLabel="Vytvořit šablonu"
        />
      )}
    </AdminShell>
  );
}
