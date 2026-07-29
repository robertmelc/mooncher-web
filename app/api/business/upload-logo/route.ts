import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveClientOperator } from "@/lib/business-auth";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Upload jde vždy přes tenhle endpoint (service role), nikdy přímo z
// klienta na Storage — bucket nemá žádnou klientskou write policy (viz
// konverzace k obrazovce biz-5), stejný důvod jako u lib/business-auth.ts.
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const operator = await resolveClientOperator(admin, accessToken);
  if (!operator.ok) {
    return NextResponse.json({ ok: false, error: operator.error }, { status: operator.status });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Chybí soubor." }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "Soubor je moc velký (max 2 MB)." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ ok: false, error: "Nepodporovaný formát obrázku." }, { status: 400 });
  }

  const ext = file.type.split("/")[1];
  const path = `${operator.clientId}/${crypto.randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from("voucher-logos")
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
  }

  const { data } = admin.storage.from("voucher-logos").getPublicUrl(path);

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
