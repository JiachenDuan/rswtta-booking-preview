import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { coachAuthConfiguration, isOperatorAuthEnabled } from "./config";

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
