import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: levels, error } = await admin
    .from("vpc_referral_levels")
    .select("id, name, threshold")
    .eq("client_id", operator.clientId)
    .order("threshold", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, levels: levels ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  let body: { name?: string; threshold?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const name = body.name?.trim();
  const threshold = body.threshold;

  if (!name || typeof threshold !== "number" || threshold <= 0 || !Number.isInteger(threshold)) {
    return NextResponse.json({ ok: false, error: "Zadejte název a kladný celočíselný práh." }, { status: 400 });
  }

  const { data: level, error } = await admin
    .from("vpc_referral_levels")
    .insert({ client_id: operator.clientId, name, threshold })
    .select("id, name, threshold")
    .single();

  if (error) {
    const message = error.message.includes("duplicate") ? "Úroveň s tímhle názvem už existuje." : error.message;
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, level });
}
