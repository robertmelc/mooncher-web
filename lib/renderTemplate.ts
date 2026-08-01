import DOMPurify from "dompurify";

export type TokenFieldSchema = {
  type: "color" | "text" | "image" | "icon_picker" | "multiselect";
  default?: string;
  max_length?: number;
  required?: boolean;
  options?: string[];
};

export type TokenSchema = Record<string, TokenFieldSchema>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Nahrazuje jen striktní {{identifier}} vzory, hodnoty vždy escapuje —
// token hodnoty jsou vstup od client_operatora, ne důvěryhodný kód.
export function substituteTokens(layout: string, values: Record<string, string>): string {
  return layout.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value !== undefined ? escapeHtml(String(value)) : "";
  });
}

export function defaultTokenValues(schema: TokenSchema): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, field] of Object.entries(schema)) {
    values[key] = field.default ?? "";
  }
  return values;
}

// Substituce + sanitizace v jednom kroku — stejná dvouvrstvá ochrana jako
// v biz-5 editoru (substituteTokens escapuje hodnoty, DOMPurify čistí
// výsledné HTML). DOMPurify běží jen v prohlížeči, proto guard na window —
// volající (klientské komponenty v /app, /business) na to musí být
// připravené vracet prázdný string při SSR/prvním renderu.
export function renderTemplateHtml(layout: string, values: Record<string, string>): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(substituteTokens(layout, values));
}

const VALID_TOKEN_TYPES = ["color", "text", "image", "icon_picker", "multiselect"];

// Server-side tvarová validace token_schema před uložením (adm-5) — šablona
// je admin-authored, ale špatný tvar by rozbil TokenField/renderování na
// biz-5 pro reálné klienty, takže se to validuje bez ohledu na důvěru k autorovi.
export function isValidTokenSchema(value: unknown): value is TokenSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((field) => {
    if (typeof field !== "object" || field === null || Array.isArray(field)) return false;
    const type = (field as Record<string, unknown>).type;
    return typeof type === "string" && VALID_TOKEN_TYPES.includes(type);
  });
}
