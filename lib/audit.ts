const ACTOR_TYPE_LABELS: Record<string, string> = {
  client_operator: "Klient",
  end_user: "Koncový uživatel",
  platform_admin: "Platform admin",
  system: "Systém",
};

export function actorTypeLabel(actorType: string): string {
  return ACTOR_TYPE_LABELS[actorType] ?? actorType;
}
