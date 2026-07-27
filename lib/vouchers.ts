const VOUCHER_TYPE_LABELS: Record<string, string> = {
  gift: "Dárkový voucher",
  reloadable: "Nabíjecí voucher",
  loyalty: "Věrnostní voucher",
  discount: "Slevový voucher",
  single_use: "Jednorázový voucher",
};

const VOUCHER_STATUS_LABELS: Record<string, string> = {
  issued: "Vydán",
  activated: "Aktivní",
  partially_used: "Částečně čerpán",
  used: "Vyčerpán",
  expired: "Expirován",
  cancelled: "Zrušen",
};

export function voucherTypeLabel(type: string): string {
  return VOUCHER_TYPE_LABELS[type] ?? type;
}

export function voucherStatusLabel(status: string): string {
  return VOUCHER_STATUS_LABELS[status] ?? status;
}
