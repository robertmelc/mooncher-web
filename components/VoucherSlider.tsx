type VoucherSliderProps = {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

export function VoucherSlider({ min, max, step, value, onChange }: VoucherSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="voucher-slider w-full"
      style={{ background: `linear-gradient(90deg, var(--teal) ${pct}%, rgba(255,255,255,.12) ${pct}%)` }}
    />
  );
}
