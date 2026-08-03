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

  const { data: settings, error } = await admin
    .from("vpc_referral_settings")
    .select("default_voucher_program_id")
    .eq("client_id", operator.clientId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    defaultVoucherProgramId: settings?.default_voucher_program_id ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const body = await req.json();
  const programId = body?.voucherProgramId;
  if (!programId || typeof programId !== "string") {
    return NextResponse.json({ ok: false, error: "Chybí voucherProgramId." }, { status: 400 });
  }

  // Program musí patřit stejnému klientovi jako operátor — appka to
  // neověřuje jen FK, ale i tímhle explicitním dotazem (stejný vzor jako
  // vlastnictví vouchru jinde v appce).
  const { data: program, error: programError } = await admin
    .from("vpc_voucher_programs")
    .select("id")
    .eq("id", programId)
    .eq("client_id", operator.clientId)
    .maybeSingle();

  if (programError) {
    return NextResponse.json({ ok: false, error: programError.message }, { status: 500 });
  }
  if (!program) {
    return NextResponse.json({ ok: false, error: "Program nenalezen." }, { status: 404 });
  }

  const { error: upsertError } = await admin
    .from("vpc_referral_settings")
    .upsert({ client_id: operator.clientId, default_voucher_program_id: programId }, { onConflict: "client_id" });

  if (upsertError) {
    return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, defaultVoucherProgramId: programId });
}
