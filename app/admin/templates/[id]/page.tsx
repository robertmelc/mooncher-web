"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AdminShell } from "@/components/AdminShell";
import { TemplateForm, type TemplateFormValues } from "@/components/TemplateForm";

type TemplateRecord = {
  id: string;
  name: string;
  category: string;
  front_layout: string;
  back_layout: string;
  thumbnail_url: string | null;
  token_schema: unknown;
  owner_client_id: string | null;
  is_active: boolean;
};

export default function AdminEditTemplatePage() {
  const params = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [template, setTemplate] = useState<TemplateRecord | null | undefined>(undefined);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

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

    async function loadData() {
      const [templateRes, clientsRes] = await Promise.all([
        fetch(`/api/admin/templates/${params.id}`, {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        }),
        fetch("/api/admin/clients", {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        }),
      ]);

      const templateJson = await templateRes.json();
      if (!templateRes.ok) {
        if (templateRes.status === 403 || templateRes.status === 404) {
          setTemplate(null);
        } else {
          setError(templateJson.error ?? "Načtení se nezdařilo.");
        }
        return;
      }
      setTemplate(templateJson.template);

      const clientsJson = await clientsRes.json();
      if (clientsRes.ok) {
        setClients(clientsJson.clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      }
    }

    loadData();
  }, [session, params.id]);

  async function handleSubmit(values: TemplateFormValues) {
    if (!session) return { ok: false, error: "Nejste přihlášeni." };

    const res = await fetch(`/api/admin/templates/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        name: values.name,
        category: values.category,
        frontLayout: values.frontLayout,
        backLayout: values.backLayout,
        tokenSchema: JSON.parse(values.tokenSchemaText || "{}"),
        ownerClientId: values.ownerClientId || null,
        thumbnailUrl: values.thumbnailUrl || null,
        isActive: values.isActive,
      }),
    });
    const json = await res.json();
    return res.ok ? { ok: true } : { ok: false, error: json.error };
  }

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Editace šablony</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/admin/templates/${params.id}`)}`}
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
    <AdminShell title={template ? template.name : "Editace šablony"}>
      {authLoading || template === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : template === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Šablona nenalezena nebo nemáte oprávnění.
        </div>
      ) : (
        <TemplateForm
          mode="edit"
          initialValues={{
            name: template.name,
            category: template.category,
            ownerClientId: template.owner_client_id ?? "",
            frontLayout: template.front_layout,
            backLayout: template.back_layout,
            tokenSchemaText: JSON.stringify(template.token_schema, null, 2),
            thumbnailUrl: template.thumbnail_url ?? "",
            isActive: template.is_active,
          }}
          clients={clients}
          onSubmit={handleSubmit}
          submitLabel="Uložit změny"
        />
      )}
    </AdminShell>
  );
}
