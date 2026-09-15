import { isTrustedOperatorClientEnabled } from "@/lib/coachAuth/config";

/**
 * In-memory authorization context for the /club browser session. It is deliberately
 * not persisted: every page load must verify the Supabase session and membership.
 */
let activeTrustedOperator = false;

export function activateTrustedOperatorContext() {
  if (!isTrustedOperatorClientEnabled()) {
    throw new Error("Trusted operator context is only available on the configured /club route.");
  }
  activeTrustedOperator = true;
}

export function deactivateTrustedOperatorContext() {
  activeTrustedOperator = false;
}

export function isTrustedOperatorContextActive() {
  return isTrustedOperatorClientEnabled() && activeTrustedOperator;
}
