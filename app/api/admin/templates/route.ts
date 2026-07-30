import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { isValidTokenSchema } from "@/lib/renderTemplate";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: templates, error } = await admin
    .from("vpc_voucher_templates")
    .select("id, name, category, thumbnail_url, owner_client_id, is_active, owner:vpc_clients ( name )")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: templates ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const body = await req.json();
  const { name, category, frontLayout, backLayout, tokenSchema, ownerClientId, thumbnailUrl } = body ?? {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "Název je povinný." }, { status: 400 });
  }
  if (!TEMPLATE_CATEGORIES.includes(category)) {
    return NextResponse.json({ ok: false, error: "Neplatná kategorie." }, { status: 400 });
  }
  if (typeof frontLayout !== "string" || frontLayout.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "Front layout je povinný." }, { status: 400 });
  }
  if (typeof backLayout !== "string" || backLayout.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "Back layout je povinný." }, { status: 400 });
  }
  if (!isValidTokenSchema(tokenSchema)) {
    return NextResponse.json(
      { ok: false, error: "token_schema musí být objekt, kde každé pole má platný 'type'." },
      { status: 400 }
    );
  }

  const { data: created, error: insertError } = await admin
    .from("vpc_voucher_templates")
    .insert({
      name: name.trim(),
      category,
      front_layout: frontLayout,
      back_layout: backLayout,
      token_schema: tokenSchema,
      owner_client_id: ownerClientId || null,
      thumbnail_url: thumbnailUrl || null,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.template_created",
    target_table: "vpc_voucher_templates",
    target_id: created.id,
    after_state: { name: name.trim(), category, ownerClientId: ownerClientId || null },
  });

  return NextResponse.json({ ok: true, id: created.id });
}
