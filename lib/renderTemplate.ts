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
