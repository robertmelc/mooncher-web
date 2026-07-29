import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

// Ukládá design_config (template_id + tokens) na EXISTUJÍCÍ program.
// Nevytváří nový program a needituje status — network_scope (biz-6) ještě
// není postavené, takže draft→active přechod tady záměrně neřešíme.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  let body: { templateId?: string; tokens?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (!body.templateId || !body.tokens) {
    return NextResponse.json({ ok: false, error: "Chybí template_id nebo tokens." }, { status: 400 });
  }

  const { data: program, error: programError } = await admin
    .from("vpc_voucher_programs")
    .select("id, client_id, design_config")
    .eq("id", params.id)
    .maybeSingle();

  if (programError) {
    return NextResponse.json({ ok: false, error: programError.message }, { status: 500 });
  }
  // Vlastnictví — defense in depth, stejný vzorec jako jinde.
  if (!program || program.client_id !== operator.clientId) {
    return NextResponse.json({ ok: false, error: "Program nenalezen." }, { status: 404 });
  }

  const existingConfig = (program.design_config as Record<string, unknown>) ?? {};
  const newConfig = {
    ...existingConfig,
    template_id: body.templateId,
    tokens: body.tokens,
  };

  const { error: updateError } = await admin
    .from("vpc_voucher_programs")
    .update({ design_config: newConfig })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
