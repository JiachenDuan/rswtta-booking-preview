export function isCoachAuthEnabled(): boolean {
  return process.env.COACH_AUTH_ENABLED === "true";
}

/** Public rollout switch: when true the browser must not use the legacy Club credential or generic tables. */
export function isTrustedOperatorClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TRUSTED_OPERATOR_AUTH_ENABLED === "true";
}

export function coachAuthConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const siteUrl = process.env.COACH_AUTH_SITE_URL;
  return url && key && siteUrl ? { url, key, siteUrl } : null;
}
