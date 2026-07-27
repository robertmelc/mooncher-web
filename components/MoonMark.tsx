export function MoonMark({ size = 26 }: { size?: number }) {
  return (
    <div
      className="moon-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
