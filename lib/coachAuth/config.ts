export function isCoachAuthEnabled(): boolean {
  return process.env.COACH_AUTH_ENABLED === "true";
}

/** Enable the shared secure sign-in/confirmation boundary during Club rollout. */
export function isOperatorAuthEnabled(): boolean {
  return isCoachAuthEnabled() || process.env.NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED !== "false";
}

/** True only in the browser on /club when the trusted rollout is configured. */
export function isTrustedOperatorClientEnabled(): boolean {
  const path = typeof window === "undefined" ? "" : window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/club" && process.env.NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED !== "false";
}

export function coachAuthConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const siteUrl = process.env.COACH_AUTH_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return url && key && siteUrl ? { url, key, siteUrl } : null;
}
