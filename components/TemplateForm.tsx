"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { Button } from "@/components/Button";
import { TEMPLATE_CATEGORIES, templateCategoryLabel } from "@/lib/templates";
import { substituteTokens, defaultTokenValues, isValidTokenSchema, type TokenSchema } from "@/lib/renderTemplate";

export type TemplateFormValues = {
  name: string;
  category: string;
  ownerClientId: string;
  frontLayout: string;
  backLayout: string;
  tokenSchemaText: string;
  thumbnailUrl: string;
  isActive: boolean;
};

type TemplateFormProps = {
  mode: "create" | "edit";
  initialValues: TemplateFormValues;
  clients: { id: string; name: string }[];
  onSubmit: (values: TemplateFormValues) => Promise<{ ok: boolean; error?: string }>;
  submitLabel: string;
};

export function TemplateForm({ mode, initialValues, clients, onSubmit, submitLabel }: TemplateFormProps) {
  const [values, setValues] = useState<TemplateFormValues>(initialValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function update<K extends keyof TemplateFormValues>(key: K, value: TemplateFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  let parsedSchema: TokenSchema | null = null;
  let schemaError: string | null = null;
  try {
    const parsed = values.tokenSchemaText.trim() === "" ? {} : JSON.parse(values.tokenSchemaText);
    if (isValidTokenSchema(parsed)) {
      parsedSchema = parsed;
    } else {
      schemaError = "Každé pole musí mít platný 'type' (color/text/image/icon_picker/multiselect).";
    }
  } catch {
    schemaError = "token_schema není platný JSON.";
  }

  const previewHtml =
    parsedSchema && typeof window !== "undefined"
      ? DOMPurify.sanitize(substituteTokens(values.frontLayout, defaultTokenValues(parsedSchema)))
      : "";

  async function handleSubmit() {
    if (schemaError) {
      setMessage({ text: schemaError, ok: false });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await onSubmit(values);
    setSaving(false);
    setMessage({ text: result.ok ? "Uloženo." : result.error ?? "Uložení se nezdařilo.", ok: result.ok });
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex flex-1 flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Název</label>
          <input
            type="text"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Kategorie</label>
          <select
            value={values.category}
            onChange={(e) => update("category", e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {templateCategoryLabel(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Vlastník</label>
          <select
            value={values.ownerClientId}
            onChange={(e) => update("ownerClientId", e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          >
            <option value="">Sdílená (dostupná všem klientům)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                Exkluzivní — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Thumbnail URL (volitelné)</label>
          <input
            type="text"
            value={values.thumbnailUrl}
            onChange={(e) => update("thumbnailUrl", e.target.value)}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Front layout (HTML/CSS, {"{{token}}"} placeholdery)</label>
          <textarea
            value={values.frontLayout}
            onChange={(e) => update("frontLayout", e.target.value)}
            rows={8}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[11.5px] text-ink"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">Back layout</label>
          <textarea
            value={values.backLayout}
            onChange={(e) => update("backLayout", e.target.value)}
            rows={6}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[11.5px] text-ink"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] text-ink-faint">token_schema (JSON)</label>
          <textarea
            value={values.tokenSchemaText}
            onChange={(e) => update("tokenSchemaText", e.target.value)}
            rows={8}
            className="rounded-sm border border-line-strong bg-panel px-3 py-2 font-mono text-[11.5px] text-ink"
          />
          {schemaError && <p className="text-[11px] text-danger">{schemaError}</p>}
        </div>

        {mode === "edit" && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) => update("isActive", e.target.checked)}
            />
            Aktivní (viditelná v galerii)
          </label>
        )}

        <Button onClick={handleSubmit} type="button" disabled={saving} className="mt-2">
          {saving ? "Ukládám…" : submitLabel}
        </Button>
        {message && (
          <p className={`text-[11.5px] ${message.ok ? "text-positive" : "text-danger"}`}>{message.text}</p>
        )}
      </div>

      <div className="flex-1">
        <div className="mb-2 text-[11.5px] text-ink-faint">Živý náhled (výchozí hodnoty token_schema)</div>
        {schemaError ? (
          <p className="text-[11.5px] text-ink-faint">Náhled nedostupný, dokud není token_schema platný JSON.</p>
        ) : (
          <div className="max-w-[320px]" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </div>
    </div>
  );
}
