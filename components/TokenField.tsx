import type { TokenFieldSchema } from "@/lib/renderTemplate";

type TokenFieldProps = {
  label: string;
  schema: TokenFieldSchema;
  value: string;
  onChange: (value: string) => void;
  onImageUpload?: (file: File) => void;
  uploading?: boolean;
};

export function TokenField({ label, schema, value, onChange, onImageUpload, uploading }: TokenFieldProps) {
  if (schema.type === "color") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11.5px] text-ink-faint">{label}</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#22d3b0"}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 rounded-sm border border-line-strong bg-panel"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
          />
        </div>
      </div>
    );
  }

  if (schema.type === "text") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11.5px] text-ink-faint">{label}</label>
        <input
          type="text"
          value={value}
          maxLength={schema.max_length}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
        />
      </div>
    );
  }

  if (schema.type === "image") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11.5px] text-ink-faint">{label}</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onImageUpload) onImageUpload(file);
          }}
          className="text-[12px] text-ink-dim"
        />
        {uploading && <p className="text-[11px] text-ink-faint">Nahrávám…</p>}
        {value && !uploading && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-16 w-16 rounded-sm object-cover" />
        )}
      </div>
    );
  }

  // icon_picker / multiselect — zjednodušeně jako single-select z options
  const options = schema.options ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11.5px] text-ink-faint">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-line-strong bg-panel px-3 py-2 text-sm text-ink"
      >
        <option value="">Vyberte…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
