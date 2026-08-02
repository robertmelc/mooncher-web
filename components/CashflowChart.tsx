"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";

type CashflowChartProps = {
  data: { day: string; inflow: number; outflow: number }[];
};

const WIDTH = 640;
const HEIGHT = 190;
const MARGIN = { top: 6, right: 4, bottom: 18, left: 50 };
const GAP = 4;
const INNER_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const BASELINE_Y = MARGIN.top + INNER_HEIGHT / 2;
const HALF = INNER_HEIGHT / 2 - 2;

// Kulaté "pěkné" kroky mřížky (1-2-5 × 10^n), ne libovolné zlomky maxima —
// jinak by osa Y ukazovala matoucí čísla jako "733 Kč".
function niceStep(maxValue: number, targetTicks = 4): number {
  if (maxValue <= 0) return 1;
  const rawStep = maxValue / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  return niceResidual * magnitude;
}

function formatDayLabel(day: string): string {
  const date = new Date(day);
  return `${date.getDate()}.${date.getMonth() + 1}.`;
}

function formatAxisValue(value: number): string {
  return value.toLocaleString("cs-CZ");
}

export function CashflowChart({ data }: CashflowChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="text-[11.5px] text-ink-faint">Zatím žádná data.</p>;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.inflow, d.outflow)));
  const step = niceStep(max);
  const niceMax = Math.ceil(max / step) * step;
  const gridValues: number[] = [];
  for (let v = step; v <= niceMax + 0.0001; v += step) gridValues.push(v);

  const barWidth = Math.max(2, INNER_WIDTH / data.length - GAP);
  const valueToOffset = (v: number) => (v / niceMax) * HALF;

  // Popisky osy X jen na každém ~5.-7. dni, ať se nepřekrývají — u 30
  // sloupců by popisek na každém byl nečitelný shluk.
  const xLabelStep = Math.max(1, Math.ceil(data.length / 6));

  const hovered = hoveredIndex !== null ? data[hoveredIndex] : null;
  const hoveredX = hoveredIndex !== null ? MARGIN.left + hoveredIndex * (barWidth + GAP) : 0;
  const TOOLTIP_WIDTH = 96;
  const TOOLTIP_HEIGHT = 44;
  const flipLeft = hoveredIndex !== null && hoveredIndex > data.length / 2;
  const tooltipXRaw = flipLeft ? hoveredX - TOOLTIP_WIDTH - 6 : hoveredX + barWidth + 6;
  const tooltipX = Math.min(Math.max(tooltipXRaw, MARGIN.left), WIDTH - MARGIN.right - TOOLTIP_WIDTH);
  const tooltipY = MARGIN.top + 2;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" preserveAspectRatio="none">
      {/* Mřížka + popisky osy Y — na obou polovinách stejné měřítko (nahoře
          inflow, dole outflow), takže se hodnota čte podle vzdálenosti od
          nulové linie na obě strany stejně. */}
      {gridValues.map((v) => {
        const offset = valueToOffset(v);
        const topY = BASELINE_Y - offset;
        const bottomY = BASELINE_Y + offset;
        return (
          <g key={v}>
            <line x1={MARGIN.left} y1={topY} x2={WIDTH - MARGIN.right} y2={topY} stroke="var(--line)" strokeWidth={1} />
            <line x1={MARGIN.left} y1={bottomY} x2={WIDTH - MARGIN.right} y2={bottomY} stroke="var(--line)" strokeWidth={1} />
            <text x={MARGIN.left - 6} y={topY} textAnchor="end" dominantBaseline="middle" fontSize={9} className="font-mono fill-ink-faint">
              {formatAxisValue(v)}
            </text>
            <text x={MARGIN.left - 6} y={bottomY} textAnchor="end" dominantBaseline="middle" fontSize={9} className="font-mono fill-ink-faint">
              {formatAxisValue(v)}
            </text>
          </g>
        );
      })}
      <line
        x1={MARGIN.left}
        y1={BASELINE_Y}
        x2={WIDTH - MARGIN.right}
        y2={BASELINE_Y}
        stroke="var(--line-strong)"
        strokeWidth={1}
      />
      <text x={MARGIN.left - 6} y={BASELINE_Y} textAnchor="end" dominantBaseline="middle" fontSize={9} className="font-mono fill-ink-faint">
        0
      </text>

      {data.map((d, i) => {
        const x = MARGIN.left + i * (barWidth + GAP);
        const inflowHeight = valueToOffset(d.inflow);
        const outflowHeight = valueToOffset(d.outflow);
        const isHovered = hoveredIndex === i;
        const showXLabel = i % xLabelStep === 0;

        return (
          <g key={d.day}>
            {isHovered && (
              <rect
                x={x - GAP / 2}
                y={MARGIN.top}
                width={barWidth + GAP}
                height={INNER_HEIGHT}
                fill="var(--line)"
              />
            )}
            <rect x={x} y={BASELINE_Y - inflowHeight} width={barWidth} height={inflowHeight} fill="var(--positive)" rx={1} />
            <rect x={x} y={BASELINE_Y} width={barWidth} height={outflowHeight} fill="var(--danger)" rx={1} />
            {showXLabel && (
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 4}
                textAnchor="middle"
                fontSize={9}
                className="font-mono fill-ink-faint"
              >
                {formatDayLabel(d.day)}
              </text>
            )}
            {/* Neviditelný hit target přes celou výšku sloupce — u nízkých
                hodnot by samotný barevný sloupec byl na najetí myší příliš
                malý cíl. */}
            <rect
              x={x - GAP / 2}
              y={MARGIN.top}
              width={barWidth + GAP}
              height={INNER_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          </g>
        );
      })}

      {hovered && (
        <g pointerEvents="none">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={TOOLTIP_WIDTH}
            height={TOOLTIP_HEIGHT}
            rx={3}
            fill="var(--panel2)"
            stroke="var(--line-strong)"
            strokeWidth={1}
          />
          <text x={tooltipX + 8} y={tooltipY + 13} fontSize={9} className="font-mono fill-ink">
            {formatDayLabel(hovered.day)}
          </text>
          <text x={tooltipX + 8} y={tooltipY + 26} fontSize={9} className="font-mono" fill="var(--positive)">
            +{formatCurrency(hovered.inflow, "CZK")}
          </text>
          <text x={tooltipX + 8} y={tooltipY + 38} fontSize={9} className="font-mono" fill="var(--danger)">
            -{formatCurrency(hovered.outflow, "CZK")}
          </text>
        </g>
      )}
    </svg>
  );
}
