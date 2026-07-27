type TransactionRowProps = {
  label: string;
  dateLabel: string;
  amountLabel: string;
  positive: boolean;
};

export function TransactionRow({ label, dateLabel, amountLabel, positive }: TransactionRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-3">
      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 flex-shrink-0 rounded-full border border-line-strong bg-panel3" />
        <div>
          <div className="text-[13px] font-semibold">{label}</div>
          <div className="text-[11.5px] text-ink-faint">{dateLabel}</div>
        </div>
      </div>
      <div
        className="font-mono text-[13.5px] font-bold"
        style={{ color: positive ? "var(--positive)" : "var(--danger)" }}
      >
        {amountLabel}
      </div>
    </div>
  );
}
