import { NextResponse } from "next/server";

// DOČASNÝ diagnostický endpoint — zjišťuje, jestli GOSMS_* proměnné
// prostředí vůbec dorazily do běžícího runtime na produkci. Nevrací
// žádnou tajnou hodnotu, jen přítomnost a délku. Smazat hned po použití.
export async function GET() {
  const keys = ["GOSMS_CLIENT_ID", "GOSMS_CLIENT_SECRET", "GOSMS_CHANNEL"];
  const report = Object.fromEntries(
    keys.map((key) => {
      const value = process.env[key];
      return [key, value ? `present, length ${value.length}` : "missing"];
    })
  );
  return NextResponse.json(report);
}
