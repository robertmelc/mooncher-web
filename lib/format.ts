export function formatCurrency(amount: number, currency: string): string {
  if (currency === "CZK") {
    return `${amount.toLocaleString("cs-CZ")} Kč`;
  }
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
