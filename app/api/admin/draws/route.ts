import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { runDraw } from "@/lib/draw";

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: draws, error } = await admin
    .from("vpc_admin_draws")
    .select(
      "id, range_min, range_max, seed, seed_source, result_hash, result_number, prize_description, created_by_email, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, draws: draws ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  let body: { rangeMin?: number; rangeMax?: number; seed?: string; prizeDescription?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  const { rangeMin, rangeMax, seed, prizeDescription } = body;

  if (
    typeof rangeMin !== "number" ||
    typeof rangeMax !== "number" ||
    !Number.isInteger(rangeMin) ||
    !Number.isInteger(rangeMax)
  ) {
    return NextResponse.json({ ok: false, error: "Rozsah musí být celá čísla." }, { status: 400 });
  }
  if (rangeMax < rangeMin) {
    return NextResponse.json({ ok: false, error: "Číslo do musí být větší nebo rovno číslu od." }, { status: 400 });
  }
  if (!prizeDescription || !prizeDescription.trim()) {
    return NextResponse.json({ ok: false, error: "Zadejte text výhry." }, { status: 400 });
  }

  const trimmedSeed = seed?.trim() || undefined;
  const draw = runDraw(rangeMin, rangeMax, trimmedSeed);

  const { data: userData } = await admin.auth.getUser(accessToken);

  const { data: inserted, error: insertError } = await admin
    .from("vpc_admin_draws")
    .insert({
      range_min: rangeMin,
      range_max: rangeMax,
      seed: draw.seed,
      seed_source: draw.seedSource,
      result_hash: draw.resultHash,
      result_number: draw.resultNumber,
      prize_description: prizeDescription.trim(),
      created_by_email: result.email,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ ok: false, error: insertError?.message ?? "Zápis se nezdařil." }, { status: 500 });
  }

  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.draw_executed",
    target_table: "vpc_admin_draws",
    target_id: inserted.id,
    after_state: { rangeMin, rangeMax, resultNumber: draw.resultNumber, seedSource: draw.seedSource },
  });

  return NextResponse.json({
    ok: true,
    draw: {
      id: inserted.id,
      range_min: rangeMin,
      range_max: rangeMax,
      seed: draw.seed,
      seed_source: draw.seedSource,
      result_hash: draw.resultHash,
      result_number: draw.resultNumber,
      prize_description: prizeDescription.trim(),
      created_by_email: result.email,
      created_at: inserted.created_at,
    },
  });
}
