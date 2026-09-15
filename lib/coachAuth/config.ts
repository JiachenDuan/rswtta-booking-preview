export function isCoachAuthEnabled(): boolean {
  return process.env.COACH_AUTH_ENABLED === "true";
}

export function coachAuthConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const siteUrl = process.env.COACH_AUTH_SITE_URL;
  return url && key && siteUrl ? { url, key, siteUrl } : null;
}
