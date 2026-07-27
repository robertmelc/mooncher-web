const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  load: "Nabití vouchru",
  redeem: "Uplatnění vouchru",
  refund: "Vrácení platby",
  transfer: "Přesun mezi vouchery",
  adjustment: "Manuální úprava",
  expiry: "Expirace zůstatku",
};

export function transactionTypeLabel(type: string): string {
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}
