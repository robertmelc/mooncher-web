"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DOMPurify from "dompurify";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { BusinessShell } from "@/components/BusinessShell";
import { TokenField } from "@/components/TokenField";
import { Button } from "@/components/Button";
import { substituteTokens, defaultTokenValues, type TokenSchema } from "@/lib/renderTemplate";

type TemplateData = {
  id: string;
  name: string;
  category: string;
  front_layout: string;
  token_schema: TokenSchema;
};

type ProgramOption = {
  id: string;
  name: string;
};

function prettifyKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

export default function TemplateEditorPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOperator, setIsOperator] = useState<boolean | undefined>(undefined);
  const [template, setTemplate] = useState<TemplateData | null | undefined>(undefined);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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

    async function loadOperatorAndPrograms() {
      const res = await fetch("/api/business/operator", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      setIsOperator(res.ok);
      if (!res.ok) return;

      const programsRes = await fetch("/api/business/programs", {
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });
      const programsJson = await programsRes.json();
      if (programsRes.ok) {
        setPrograms(programsJson.programs);
      }
    }

    loadOperatorAndPrograms();
  }, [session]);

  useEffect(() => {
    if (!isOperator) return;

    async function loadTemplate() {
      // Sdílené šablony — přímý klientský dotaz, RLS na tohle nezávisí
      // na chybějícím JWT claimu (viz obrazovka biz-4).
      const { data, error: templateError } = await supabase
        .from("vpc_voucher_templates")
        .select("id, name, category, front_layout, token_schema")
        .eq("id", params.id)
        .maybeSingle();

      if (templateError) {
        setError(templateError.message);
        return;
      }
      if (!data) {
        setTemplate(null);
        return;
      }

      setTemplate(data as unknown as TemplateData);
      setTokenValues(defaultTokenValues(data.token_schema as TokenSchema));
    }

    loadTemplate();
  }, [isOperator, params.id]);

  async function handleImageUpload(key: string, file: File) {
    if (!session) return;
    setUploadingKey(key);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/business/upload-logo", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const json = await res.json();

    setUploadingKey(null);

    if (!res.ok) {
      setError(json.error ?? "Nahrání se nezdařilo.");
      return;
    }

    setTokenValues((prev) => ({ ...prev, [key]: json.url }));
  }

  async function handlePublish() {
    if (!session || !selectedProgramId || !template) return;
    setSaving(true);
    setSaveMessage(null);

    const res = await fetch(`/api/business/programs/${selectedProgramId}/design`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ templateId: template.id, tokens: tokenValues }),
    });
    const json = await res.json();

    setSaving(false);
    setSaveMessage(json.ok ? "Publikováno." : (json.error ?? "Uložení se nezdařilo."));
  }

  const previewHtml =
    template && typeof window !== "undefined"
      ? DOMPurify.sanitize(substituteTokens(template.front_layout, tokenValues))
      : "";

  if (!authLoading && !session) {
    return (
      <main className="min-h-screen px-5 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-6">
          <header className="border-b border-line pb-4">
            <h1 className="font-display text-lg font-bold tracking-tight">Editor šablony</h1>
          </header>
          <p className="font-mono text-sm text-ink-dim">
            Nejste přihlášeni —{" "}
            <Link
              href={`/app/login?next=${encodeURIComponent(`/business/templates/${params.id}`)}`}
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
    <BusinessShell title={template ? `${template.name} — úprava` : "Editor šablony"}>
      {authLoading || isOperator === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám…</p>
      ) : !isOperator ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Tento účet není napojený na žádného klienta.
        </div>
      ) : error ? (
        <p className="font-mono text-sm text-danger">{error}</p>
      ) : template === undefined ? (
        <p className="font-mono text-sm text-ink-dim">Načítám šablonu…</p>
      ) : template === null ? (
        <div className="rounded-sm border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
          Šablona nenalezena.
        </div>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="flex flex-1 flex-col gap-3.5">
            <label className="text-[11.5px] text-ink-faint">Pro který program</label>
            <select
              value={selectedProgramId}
              onChange={(e) => setSelectedProgramId(e.target.value)}
              className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
            >
              <option value="">Vyberte program</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {Object.entries(template.token_schema).map(([key, schema]) => (
              <TokenField
                key={key}
                label={prettifyKey(key)}
                schema={schema}
                value={tokenValues[key] ?? ""}
                onChange={(value) => setTokenValues((prev) => ({ ...prev, [key]: value }))}
                onImageUpload={(file) => handleImageUpload(key, file)}
                uploading={uploadingKey === key}
              />
            ))}

            <Button
              onClick={handlePublish}
              className="mt-2"
              type="button"
              disabled={!selectedProgramId || saving}
            >
              {saving ? "Publikuji…" : "Publikovat program"}
            </Button>
            {!selectedProgramId && (
              <p className="text-[11px] text-ink-faint">Nejdřív vyberte program.</p>
            )}
            {saveMessage && (
              <p className={`text-[11.5px] ${saveMessage === "Publikováno." ? "text-positive" : "text-danger"}`}>
                {saveMessage}
              </p>
            )}
          </div>

          <div className="flex-1">
            <div className="mb-2 text-[11.5px] text-ink-faint">Živý náhled</div>
            <div
              className="max-w-[320px]"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      )}
    </BusinessShell>
  );
}
