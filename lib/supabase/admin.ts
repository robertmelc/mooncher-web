import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only ever import this in
 * server-side code (Route Handlers), never in a client component.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
