type CashflowChartProps = {
  data: { day: string; inflow: number; outflow: number }[];
};

const WIDTH = 600;
const HEIGHT = 160;
const GAP = 4;

export function CashflowChart({ data }: CashflowChartProps) {
  if (data.length === 0) {
    return <p className="text-[11.5px] text-ink-faint">Zatím žádná data.</p>;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.inflow, d.outflow)));
  const barWidth = Math.max(2, WIDTH / data.length - GAP);
  const half = HEIGHT / 2 - 4;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" preserveAspectRatio="none">
      <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="var(--line)" strokeWidth={1} />
      {data.map((d, i) => {
        const x = i * (barWidth + GAP);
        const inflowHeight = (d.inflow / max) * half;
        const outflowHeight = (d.outflow / max) * half;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={HEIGHT / 2 - inflowHeight}
              width={barWidth}
              height={inflowHeight}
              fill="var(--positive)"
              rx={1}
            />
            <rect x={x} y={HEIGHT / 2} width={barWidth} height={outflowHeight} fill="var(--danger)" rx={1} />
          </g>
        );
      })}
    </svg>
  );
}
