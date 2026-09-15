import { createClient } from "@supabase/supabase-js";

export function createCoachSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Club operator authentication is not configured.");

  // Use the same default localStorage key and persistence model as lib/supabase.
  // The confirmation page parses invite/recovery fragments itself to avoid a
  // callback race, then /club restores this exact persisted session.
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
}
