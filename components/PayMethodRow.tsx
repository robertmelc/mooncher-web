type PayMethodRowProps = {
  icon: string;
  label: string;
  selected: boolean;
  onClick: () => void;
};

export function PayMethodRow({ icon, label, selected, onClick }: PayMethodRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pay-row w-full text-left ${selected ? "selected" : ""}`}
    >
      <div className="pay-icon">{icon}</div>
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="pay-radio" />
    </button>
  );
}
