import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

async function verifyOwnership(admin: ReturnType<typeof createAdminClient>, id: string, clientId: string) {
  const { data: level, error } = await admin
    .from("vpc_referral_levels")
    .select("id")
    .eq("id", id)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return { error: NextResponse.json({ ok: false, error: error.message }, { status: 500 }) };
  if (!level) return { error: NextResponse.json({ ok: false, error: "Úroveň nenalezena." }, { status: 404 }) };
  return { ok: true as const };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  // Vlastnictví — defense in depth, ať nejde upravit úroveň cizího klienta
  // uhodnutím id.
  const ownership = await verifyOwnership(admin, params.id, operator.clientId);
  if ("error" in ownership) return ownership.error;

  let body: { name?: string; threshold?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const update: { name?: string; threshold?: number } = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ ok: false, error: "Název nesmí být prázdný." }, { status: 400 });
    update.name = name;
  }
  if (body.threshold !== undefined) {
    if (typeof body.threshold !== "number" || body.threshold <= 0 || !Number.isInteger(body.threshold)) {
      return NextResponse.json({ ok: false, error: "Práh musí být kladné celé číslo." }, { status: 400 });
    }
    update.threshold = body.threshold;
  }

  const { data: level, error } = await admin
    .from("vpc_referral_levels")
    .update(update)
    .eq("id", params.id)
    .select("id, name, threshold")
    .single();

  if (error) {
    const message = error.message.includes("duplicate") ? "Úroveň s tímhle názvem už existuje." : error.message;
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, level });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const ownership = await verifyOwnership(admin, params.id, operator.clientId);
  if ("error" in ownership) return ownership.error;

  const { error } = await admin.from("vpc_referral_levels").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
