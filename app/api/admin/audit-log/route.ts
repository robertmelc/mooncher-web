import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

const ROW_LIMIT = 200;
const WINDOW_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  const adminUserId = userData.user?.id ?? null;

  // Zobrazení globálního audit logu se loguje samo — mírně sebe-odkazující,
  // ale konzistentní s adm-1/adm-3/adm-4 a užitečné (kdo a kdy log prohlížel).
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: adminUserId,
    action: "admin.audit_log_viewed",
    target_table: "vpc_audit_log",
    target_id: adminUserId,
  });

  const window = req.nextUrl.searchParams.get("window") ?? "7d";
  const actorType = req.nextUrl.searchParams.get("actorType");

  let query = admin
    .from("vpc_audit_log")
    .select("id, actor_type, actor_id, action, target_table, target_id, created_at")
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  const windowDays = WINDOW_DAYS[window];
  if (windowDays) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", cutoff);
  }
  if (actorType) {
    query = query.eq("actor_type", actorType);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: rows ?? [] });
}
