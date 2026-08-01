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

// Admin-vydané vouchery (/admin/issue-voucher, typicky výhry z Losování)
// dostávají vlastní štítek bez ohledu na voucher_type programu, pod kterým
// byly vydány — jinak by výherní voucher na 'loyalty' programu vypadal
// stejně jako běžný věrnostní voucher toho programu.
export function voucherEyebrow(type: string, isAdminIssued: boolean): string {
  return isAdminIssued ? "Výherní voucher" : voucherTypeLabel(type);
}

export function voucherStatusLabel(status: string): string {
  return VOUCHER_STATUS_LABELS[status] ?? status;
}
