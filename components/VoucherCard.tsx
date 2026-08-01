import { MoonMark } from "@/components/MoonMark";

type VoucherCardProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
  flipped?: boolean;
  validUntil?: string;
  // Volitelný akcent z design_config.tokens.brand_color klientova programu —
  // stejný color-mix() vzorec jako u skutečných šablon na detailu (03),
  // jen aplikovaný na VoucherCard místo syrového HTML. Bez tohohle propu
  // karta vypadá jako dřív (natvrdo teal).
  accentColor?: string;
  // design_config.tokens.logo — chybí-li, vykreslí se MoonMark (vlastní
  // branding), ne prázdné místo. Platí na všech místech, co VoucherCard
  // používají (list, detail fallback, load, gift), ne jen tam, kde se
  // logoUrl vyplňuje.
  logoUrl?: string;
};

export function VoucherCard({
  eyebrow,
  title,
  subtitle,
  amount,
  code,
  status,
  flipped = false,
  validUntil,
  accentColor,
  logoUrl,
}: VoucherCardProps) {
  const cardStyle = accentColor
    ? {
        background: `radial-gradient(circle at 90% -20%, color-mix(in srgb, ${accentColor} 30%, transparent), transparent 55%), linear-gradient(160deg, rgba(255,255,255,.05), rgba(255,255,255,0) 40%), linear-gradient(160deg, color-mix(in srgb, ${accentColor} 22%, #123029), #071a16 70%)`,
      }
    : undefined;
  const watermarkStyle = accentColor
    ? {
        background: `radial-gradient(circle at 35% 35%, color-mix(in srgb, ${accentColor} 45%, transparent), transparent 62%)`,
      }
    : undefined;
  const eyebrowStyle = accentColor ? { color: accentColor } : undefined;

  return (
    <div className="voucher-card" style={cardStyle}>
      <div className="watermark" style={watermarkStyle} aria-hidden="true" />
      <div className="stub">
        <div className="stub-label">Voucher</div>
        <div className="stub-sub">Digital</div>
      </div>
      {flipped ? (
        <div className="relative z-10 min-w-0 flex-1 p-5">
          <div className="flex items-center justify-between gap-2">
            <div
              className={`font-mono text-[10px] uppercase tracking-wider ${accentColor ? "" : "text-teal"}`}
              style={eyebrowStyle}
            >
              Podmínky
            </div>
            <span className="badge">{status}</span>
          </div>
          <div className="mt-1 font-display text-base font-extrabold tracking-tight">
            Jak voucher funguje
          </div>
          <div className="mt-2 text-[11.5px] leading-relaxed text-ink-dim">
            Tento voucher odemyká přístup k prémiovým funkcím a službám {subtitle}. Nepřenosný,
            vázaný na účet držitele.
          </div>
          <div className="barcode" aria-hidden="true" />
          <div className="mt-3.5 flex justify-between font-mono text-[10px] text-ink-faint">
            <span>{validUntil ? `Platnost do ${validUntil}` : "Bez expirace"}</span>
            <span>{code}</span>
          </div>
        </div>
      ) : (
        <div className="relative z-10 min-w-0 flex-1 p-5 pr-[76px]">
          <div className="absolute right-5 top-1/2 -translate-y-1/2">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
            ) : (
              <MoonMark size={48} />
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div
              className={`font-mono text-[10px] uppercase tracking-wider ${accentColor ? "" : "text-teal"}`}
              style={eyebrowStyle}
            >
              {eyebrow}
            </div>
            <span className="badge">{status}</span>
          </div>
          <div className="mt-1 font-display text-xl font-extrabold tracking-tight">{title}</div>
          <div className="mt-0.5 text-[11.5px] text-ink-dim">{subtitle}</div>
          <div className="mt-3 font-display text-[27px] font-extrabold">{amount}</div>
          <div className="mt-3.5 flex justify-between font-mono text-[10px] text-ink-faint">
            <span>{code}</span>
            <span>mooncher</span>
          </div>
        </div>
      )}
    </div>
  );
}
