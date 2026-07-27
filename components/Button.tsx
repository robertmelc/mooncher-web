type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
};

export function Button({
  children,
  variant = "primary",
  onClick,
  type = "button",
  className = "",
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "bg-teal text-[#04211B] shadow-[0_6px_18px_var(--teal-glow)]"
      : "border border-line-strong bg-panel2 text-ink";

  return (
    <button
      type={type}
      onClick={onClick}
      className={`w-full rounded-sm px-4 py-3 text-center text-[13.5px] font-semibold ${variantClass} ${className}`}
    >
      {children}
    </button>
  );
}
