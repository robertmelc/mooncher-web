import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";

const WINDOW_DAYS = 30;

type CashflowRow = {
  day: string;
  type: string;
  inflow: number | null;
  outflow: number | null;
  transaction_count: number;
};

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  // Audit log i na samotné zobrazení — obrazovka je nejcitlivější v appce
  // (vidí data napříč všemi klienty), viz konverzace k obrazovce adm-1.
  // target_table/target_id jsou v B1 not null a nejsou navržené pro
  // "zobrazení napříč platformou" bez konkrétního cíle — jako nejbližší
  // rozumnou volbu používáme identitu admina samotného.
  const { data: userData } = await admin.auth.getUser(accessToken);
  const adminUserId = userData.user?.id ?? null;
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: adminUserId,
    action: "admin.cashflow_viewed",
    target_table: "vpc_admin_cashflow",
    target_id: adminUserId,
  });

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: cashflowRows, error: cashflowError } = await admin
    .from("vpc_admin_cashflow")
    .select("day, type, inflow, outflow, transaction_count")
    .gte("day", cutoff);

  if (cashflowError) {
    return NextResponse.json({ ok: false, error: cashflowError.message }, { status: 500 });
  }

  const rows = (cashflowRows as CashflowRow[]) ?? [];

  const totalInflow = rows.reduce((sum, r) => sum + Number(r.inflow ?? 0), 0);
  const totalOutflow = rows.reduce((sum, r) => sum + Number(r.outflow ?? 0), 0);

  const byDay = new Map<string, { inflow: number; outflow: number }>();
  for (const r of rows) {
    const key = r.day.slice(0, 10);
    const entry = byDay.get(key) ?? { inflow: 0, outflow: 0 };
    entry.inflow += Number(r.inflow ?? 0);
    entry.outflow += Number(r.outflow ?? 0);
    byDay.set(key, entry);
  }
  const daily = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, inflow: v.inflow, outflow: v.outflow }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const { data: loadTransactions, error: feeError } = await admin
    .from("vpc_transactions")
    .select("platform_fee_amount")
    .eq("type", "load")
    .eq("status", "completed")
    .gte("created_at", cutoff);

  if (feeError) {
    return NextResponse.json({ ok: false, error: feeError.message }, { status: 500 });
  }

  const totalPlatformFee = (loadTransactions ?? []).reduce(
    (sum, t) => sum + Number(t.platform_fee_amount ?? 0),
    0
  );

  return NextResponse.json({
    ok: true,
    inflow: totalInflow,
    outflow: totalOutflow,
    platformFee: totalPlatformFee,
    daily,
  });
}
