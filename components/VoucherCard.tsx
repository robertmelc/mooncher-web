type VoucherCardProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
  flipped?: boolean;
  validUntil?: string;
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
}: VoucherCardProps) {
  return (
    <div className="voucher-card">
      <div className="watermark" aria-hidden="true" />
      <div className="stub">
        <div className="stub-label">Voucher</div>
        <div className="stub-sub">Digital</div>
      </div>
      {flipped ? (
        <div className="relative z-10 min-w-0 flex-1 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-teal">Podmínky</div>
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
        <div className="relative z-10 min-w-0 flex-1 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-teal">{eyebrow}</div>
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
