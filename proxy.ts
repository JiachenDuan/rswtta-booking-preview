import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { coachAuthConfiguration, isOperatorAuthEnabled } from "@/lib/coachAuth/config";

export async function proxy(request: NextRequest) {
  if (!isOperatorAuthEnabled()) return NextResponse.next({ request });
  const configuration = coachAuthConfiguration();
  if (!configuration) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(configuration.url, configuration.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  // Refresh expired access tokens into secure Supabase SSR cookies before a
  // Coach Server Component or Action evaluates membership.
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/coach/:path*"] };
