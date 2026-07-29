import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

type NetworkScope =
  | { type: "single_merchant"; merchant_ids: string[] }
  | { type: "defined_goods"; categories: string[] };

// Jediné místo v appce, kde program poprvé přejde draft -> active (B2 §4).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  let body: { networkScope?: NetworkScope };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (
    !body.networkScope ||
    (body.networkScope.type !== "single_merchant" && body.networkScope.type !== "defined_goods")
  ) {
    return NextResponse.json({ ok: false, error: "Neplatný network_scope." }, { status: 400 });
  }

  const { data: program, error: programError } = await admin
    .from("vpc_voucher_programs")
    .select("id, client_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (programError) {
    return NextResponse.json({ ok: false, error: programError.message }, { status: 500 });
  }
  if (!program || program.client_id !== operator.clientId) {
    return NextResponse.json({ ok: false, error: "Program nenalezen." }, { status: 404 });
  }
  if (program.status === "retired") {
    return NextResponse.json(
      { ok: false, error: "Ukončený program nelze upravovat." },
      { status: 409 }
    );
  }

  // merchant_ids se dosazuje server-side z ověřeného operátora, ne z
  // těla requestu — klient nemá jak zfalšovat cizí client_id.
  const networkScope: NetworkScope =
    body.networkScope.type === "single_merchant"
      ? { type: "single_merchant", merchant_ids: [operator.clientId] }
      : body.networkScope;

  const updates: { network_scope: NetworkScope; status?: string } = {
    network_scope: networkScope,
  };
  if (program.status === "draft") {
    updates.status = "active";
  }

  const { error: updateError } = await admin
    .from("vpc_voucher_programs")
    .update(updates)
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activated: program.status === "draft" });
}
