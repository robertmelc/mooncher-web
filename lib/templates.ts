export const TEMPLATE_CATEGORIES = ["membership", "gift", "loyalty", "event"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  membership: "Membership",
  gift: "Gift",
  loyalty: "Loyalty",
  event: "Event",
  discount: "Discount",
};

export function templateCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
