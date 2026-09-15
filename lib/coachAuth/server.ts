import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { coachAuthConfiguration, isOperatorAuthEnabled } from "./config";

export function createCoachRecoverySupabaseClient() {
  if (!isOperatorAuthEnabled()) throw new Error("Club operator access is disabled.");
  const configuration = coachAuthConfiguration();
  if (!configuration) throw new Error("Coach authentication is not configured.");

  // Recovery links must work in a different browser from the one that requested
  // them. Omitting PKCE sends the default-template implicit session fragment,
  // which the confirmation page consumes without a browser-bound verifier.
  return createClient(configuration.url, configuration.key, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export async function createCoachSupabaseClient() {
  if (!isOperatorAuthEnabled()) throw new Error("Club operator access is disabled.");
  const configuration = coachAuthConfiguration();
  if (!configuration) throw new Error("Coach authentication is not configured.");

  const cookieStore = await cookies();
  return createServerClient(configuration.url, configuration.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Actions and route handlers can.
        }
      }
    }
  });
}
