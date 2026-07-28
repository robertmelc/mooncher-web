type StatCardProps = {
  label: string;
  value: string;
  highlight?: boolean;
};

export function StatCard({ label, value, highlight = false }: StatCardProps) {
  return (
    <div
      className="flex-1 rounded-sm p-4"
      style={{
        border: "1px solid rgba(255,255,255,.12)",
        background: "linear-gradient(160deg, rgba(255,255,255,.09), rgba(255,255,255,.035))",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-2 font-display text-2xl font-bold ${highlight ? "text-teal" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
