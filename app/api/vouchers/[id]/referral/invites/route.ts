import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveContext } from "@/lib/voucherReferralContext";

type InviteRow = {
  id: string;
  phone: string;
  status: string;
  sent_at: string;
  joined_at: string | null;
  joined_end_user: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

// Seznam SMS pozvánek odeslaných z tohohle vouchru — appka zná jméno/
// e-mail jen u těch, co se už propojily (joined_end_user), u čekajících
// nezná nic víc než telefon, na který SMS poslala.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const ctx = await resolveContext(admin, req, params.id);
  if ("error" in ctx) return ctx.error;

  const { data: code } = await admin
    .from("vpc_referral_codes")
    .select("id")
    .eq("end_user_id", ctx.endUserId)
    .eq("voucher_program_id", ctx.programId)
    .maybeSingle();

  if (!code) {
    return NextResponse.json({ ok: true, invites: [] });
  }

  const { data, error } = await admin
    .from("vpc_referral_invites")
    .select(
      `id, phone, status, sent_at, joined_at,
       joined_end_user:vpc_end_users!joined_end_user_id ( first_name, last_name, email )`
    )
    .eq("referral_code_id", code.id)
    .order("sent_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const invites = (data as unknown as InviteRow[]).map((row) => ({
    id: row.id,
    phone: row.phone,
    status: row.status,
    sentAt: row.sent_at,
    joinedAt: row.joined_at,
    joinedName:
      [row.joined_end_user?.first_name, row.joined_end_user?.last_name].filter(Boolean).join(" ") || null,
    joinedEmail: row.joined_end_user?.email ?? null,
  }));

  return NextResponse.json({ ok: true, invites });
}
