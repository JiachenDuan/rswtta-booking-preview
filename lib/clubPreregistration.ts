import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/projectStore";
import type { ParentAccount } from "@/lib/types";

export type PreregistrationInput = { studentName: string; email: string; phone: string };
export type CollisionKind = "display_name" | "email" | "phone";
export type PreregistrationCollision = { accountId: string; studentName: string; kinds: CollisionKind[]; emailPresent: boolean; phonePresent: boolean; updatedAt?: string };
export type PreregistrationPreview = { normalized: PreregistrationInput; snapshotHash: string; collisionVersion: { count: number; maxUpdatedAt: string; idHash: string }; collisions: PreregistrationCollision[] };
export type PreregistrationResult = { accountId: string; activityId: string; loginAlias: string; replayed: boolean; profileSetupRequired: true; confirmed: false; authority: "club_unverified_legacy" };
export type LegacySetupLogin = { account: ParentAccount; sessionToken: string; setupOnly: true };

const clientKeyStorage = "rswtta-preregister-client-key";
export function preregistrationClientKey() {
  const existing = window.sessionStorage.getItem(clientKeyStorage);
  if (existing && existing.length >= 16) return existing;
  const created = crypto.randomUUID() + crypto.randomUUID();
  window.sessionStorage.setItem(clientKeyStorage, created);
  return created;
}

export function normalizePreregistrationInput(input: PreregistrationInput): PreregistrationInput {
  return {
    studentName: input.studentName.normalize("NFKC").trim().replace(/\s+/gu, " "),
    email: input.email.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    phone: input.phone.normalize("NFKC").trim().replace(/[\s().-]+/gu, "")
  };
}
export function normalizeLoginAlias(value: string) { return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US"); }

export function validatePreregistrationInput(input: PreregistrationInput) {
  const normalized = normalizePreregistrationInput(input);
  if (normalized.studentName.length < 1 || normalized.studentName.length > 120) throw new Error("Student name is required (maximum 120 characters).");
  if (/[\p{Cc}\p{Cf}]/u.test(normalized.studentName)) throw new Error("Student name contains unsupported control characters.");
  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized.email)) throw new Error("Enter a valid email or leave it blank.");
  if (normalized.phone && !/^\+?[0-9]{7,20}$/u.test(normalized.phone)) throw new Error("Enter a valid phone number or leave it blank.");
  return normalized;
}

export function previewPreregistrationCollisions(accounts: ParentAccount[], input: PreregistrationInput) {
  const normalized = validatePreregistrationInput(input);
  const nameKey = normalizeLoginAlias(normalized.studentName);
  return accounts.flatMap((account): PreregistrationCollision[] => {
    const kinds: CollisionKind[] = [];
    if (normalizeLoginAlias(account.studentName) === nameKey) kinds.push("display_name");
    if (normalized.email && account.email.trim().toLocaleLowerCase("en-US") === normalized.email) kinds.push("email");
    if (normalized.phone && account.phone.trim().replace(/[\s().-]+/gu, "") === normalized.phone) kinds.push("phone");
    return kinds.length ? [{ accountId: account.id, studentName: account.studentName, kinds, emailPresent: Boolean(account.email), phonePresent: Boolean(account.phone) }] : [];
  });
}

export async function previewClubPreregistration(input: PreregistrationInput, clubIdentifier: string, legacyClubProof: string): Promise<PreregistrationPreview> {
  const normalized = validatePreregistrationInput(input);
  const { data, error } = await supabase.rpc("club_preview_student_preregistration", { p_club_identifier: clubIdentifier, p_club_proof: legacyClubProof, p_client_key: preregistrationClientKey(), p_input: normalized });
  if (error) throw error;
  return data as PreregistrationPreview;
}

export async function createClubPreregistration(input: PreregistrationInput, snapshotHash: string, requestKey: string, clubIdentifier: string, legacyClubProof: string): Promise<PreregistrationResult> {
  const normalized = validatePreregistrationInput(input);
  const { data, error } = await supabase.rpc("club_preregister_student_v2", { p_club_identifier: clubIdentifier, p_club_proof: legacyClubProof, p_client_key: preregistrationClientKey(), p_request_key: requestKey, p_input: normalized, p_duplicate_snapshot_hash: snapshotHash });
  if (error) throw error;
  return data as PreregistrationResult;
}

export async function loginLegacySetupAccount(identifier: string, password: string): Promise<LegacySetupLogin> {
  const { data, error } = await supabase.rpc("parent_legacy_setup_login", { p_identifier: identifier, p_password: password, p_client_key: preregistrationClientKey() });
  if (error) throw error;
  return data as LegacySetupLogin;
}

export async function completeLegacySetup(sessionToken: string, profile: { studentName: string; parentName: string; email: string; phone: string; password: string }) {
  const password = await hashPassword(profile.password);
  const { data, error } = await supabase.rpc("parent_legacy_complete_setup", { p_session_token: sessionToken, p_client_key: preregistrationClientKey(), p_profile: { ...profile, passwordHash: password.hash, passwordSalt: password.salt } });
  if (error) throw error;
  return data as { account: ParentAccount; setupOnly: false; temporaryCredentialInvalidated: true };
}
