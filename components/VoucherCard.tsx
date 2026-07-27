type VoucherCardProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  amount: string;
  code: string;
  status: string;
};

export function VoucherCard({ eyebrow, title, subtitle, amount, code, status }: VoucherCardProps) {
  return (
    <div className="voucher-card">
      <div className="watermark" aria-hidden="true" />
      <div className="stub">
        <div className="stub-label">Voucher</div>
        <div className="stub-sub">Digital</div>
      </div>
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
    </div>
  );
}
