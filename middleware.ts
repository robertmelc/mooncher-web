import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Placeholder — role-based routing (end_user / client_operator / platform_admin)
// mezi /app, /business, /admin se doplní až s napojením na Supabase Auth (B3 §1, B4 §1.1).
export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/business/:path*", "/admin/:path*"],
};
