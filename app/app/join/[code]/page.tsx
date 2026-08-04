import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { JoinPageClient } from "./JoinPageClient";

// Server komponenta jen kvůli generateMetadata — "use client" stránky
// nesmí exportovat metadata. Interaktivní obsah zůstává v
// JoinPageClient.tsx beze změny.
export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const admin = createAdminClient();
  const { data: rawData } = await admin
    .from("vpc_referral_codes")
    .select(
      `client:vpc_clients ( name ), end_user:vpc_end_users!end_user_id ( first_name, last_name )`
    )
    .eq("id", params.code)
    .maybeSingle();

  const data = rawData as unknown as {
    client: { name: string } | null;
    end_user: { first_name: string | null; last_name: string | null } | null;
  } | null;

  const clientName = data?.client?.name ?? "Mooncher";
  const referrerName = [data?.end_user?.first_name, data?.end_user?.last_name].filter(Boolean).join(" ") || null;

  const title = `Pozvánka do ${clientName}`;
  const description = referrerName ? `${referrerName} tě zve — otevři a připoj se.` : "Otevři a připoj se.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: ["/icon-512.png"],
    },
  };
}

export default function JoinReferralPage({ params }: { params: { code: string } }) {
  return <JoinPageClient params={params} />;
}
