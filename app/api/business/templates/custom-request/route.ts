import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const ALLOWED_CATEGORIES = ["membership", "gift", "loyalty", "event", "discount"];

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  const requesterEmail = userData.user?.email;
  if (!requesterEmail) {
    return NextResponse.json({ ok: false, error: "Neplatná session." }, { status: 401 });
  }

  let body: { category?: string; description?: string; desiredDeadline?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }

  if (!body.category || !ALLOWED_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ ok: false, error: "Neplatná kategorie." }, { status: 400 });
  }
  if (!body.description || body.description.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "Popis požadavku je povinný." }, { status: 400 });
  }

  const { error: insertError } = await admin.from("vpc_template_custom_requests").insert({
    client_id: operator.clientId,
    requested_by_email: requesterEmail,
    category: body.category,
    description: body.description.trim(),
    desired_deadline: body.desiredDeadline?.trim() || null,
  });

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
