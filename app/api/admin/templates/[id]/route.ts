import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdmin } from "@/lib/admin-auth";
import { isValidTokenSchema } from "@/lib/renderTemplate";
import { TEMPLATE_CATEGORIES } from "@/lib/templates";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: template, error } = await admin
    .from("vpc_voucher_templates")
    .select(
      "id, name, category, front_layout, back_layout, thumbnail_url, token_schema, owner_client_id, is_active"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!template) {
    return NextResponse.json({ ok: false, error: "Šablona nenalezena." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, template });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const result = await resolveAdmin(admin, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const { data: existing, error: existingError } = await admin
    .from("vpc_voucher_templates")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Šablona nenalezena." }, { status: 404 });
  }

  const body = await req.json();
  const { name, category, frontLayout, backLayout, tokenSchema, ownerClientId, thumbnailUrl, isActive } =
    body ?? {};

  const updates: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Název nesmí být prázdný." }, { status: 400 });
    }
    updates.name = name.trim();
  }
  if (category !== undefined) {
    if (!TEMPLATE_CATEGORIES.includes(category)) {
      return NextResponse.json({ ok: false, error: "Neplatná kategorie." }, { status: 400 });
    }
    updates.category = category;
  }
  if (frontLayout !== undefined) {
    if (typeof frontLayout !== "string" || frontLayout.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Front layout nesmí být prázdný." }, { status: 400 });
    }
    updates.front_layout = frontLayout;
  }
  if (backLayout !== undefined) {
    if (typeof backLayout !== "string" || backLayout.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Back layout nesmí být prázdný." }, { status: 400 });
    }
    updates.back_layout = backLayout;
  }
  if (tokenSchema !== undefined) {
    if (!isValidTokenSchema(tokenSchema)) {
      return NextResponse.json(
        { ok: false, error: "token_schema musí být objekt, kde každé pole má platný 'type'." },
        { status: 400 }
      );
    }
    updates.token_schema = tokenSchema;
  }
  if (ownerClientId !== undefined) {
    updates.owner_client_id = ownerClientId || null;
  }
  if (thumbnailUrl !== undefined) {
    updates.thumbnail_url = thumbnailUrl || null;
  }
  if (isActive !== undefined) {
    updates.is_active = Boolean(isActive);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "Žádné změny k uložení." }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("vpc_voucher_templates")
    .update(updates)
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const { data: userData } = await admin.auth.getUser(accessToken);
  await admin.from("vpc_audit_log").insert({
    actor_type: "platform_admin",
    actor_id: userData.user?.id ?? null,
    action: "admin.template_updated",
    target_table: "vpc_voucher_templates",
    target_id: params.id,
    after_state: updates,
  });

  return NextResponse.json({ ok: true });
}
