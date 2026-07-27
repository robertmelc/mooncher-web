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

export function formatFeedDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const time = date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, now)) {
    return `Dnes ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `Včera ${time}`;
  }

  return `${date.getDate()}. ${date.getMonth() + 1}.`;
}
