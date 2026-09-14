import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/projectStore";
import type { ParentAccount } from "@/lib/types";

export type PreregistrationInput = { studentName: string; email: string; phone: string; loginAlias: string };
export type CollisionKind = "exact_name" | "similar_name" | "email" | "phone" | "login_alias";
export type PreregistrationCollision = { accountId: string; studentName: string; kinds: CollisionKind[]; maskedEmail: string; maskedPhone: string; status: string; updatedAt?: string };
export type StudentSearchResult = { accountId: string; shortId: string; studentName: string; maskedEmail: string; maskedPhone: string; status: string };
export type StudentSearchResponse = { normalizedQuery: string; snapshotHash: string; collisionVersion: { count: number; maxUpdatedAt: string; idHash: string }; results: StudentSearchResult[] };
export type PreregistrationPreview = { normalized: PreregistrationInput; proposedAccountId: string; snapshotHash: string; collisionVersion: { count: number; maxUpdatedAt: string; idHash: string }; collisions: PreregistrationCollision[]; requiresSameNameReview: boolean };
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

export const normalizeIdentityValue = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
export const normalizePhone = (value: string) => value.normalize("NFKC").trim().replace(/[\s().-]+/gu, "");
export function normalizePreregistrationInput(input: PreregistrationInput): PreregistrationInput {
  return {
    studentName: input.studentName.normalize("NFKC").trim().replace(/\s+/gu, " "),
    email: input.email.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    phone: normalizePhone(input.phone),
    loginAlias: normalizeIdentityValue(input.loginAlias)
  };
}
export const normalizeLoginAlias = normalizeIdentityValue;

export function validatePreregistrationInput(input: PreregistrationInput) {
  const normalized = normalizePreregistrationInput(input);
  if (normalized.studentName.length < 1 || normalized.studentName.length > 120) throw new Error("Student name is required (maximum 120 characters).");
  if (/[\p{Cc}\p{Cf}]/u.test(normalized.studentName)) throw new Error("Student name contains unsupported control characters.");
  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized.email)) throw new Error("Enter a valid email or leave it blank.");
  if (normalized.phone && !/^\+?[0-9]{7,20}$/u.test(normalized.phone)) throw new Error("Enter a valid phone number or leave it blank.");
  if (normalized.loginAlias && (normalized.loginAlias.length > 160 || /[\p{Cc}\p{Cf}]/u.test(normalized.loginAlias))) throw new Error("Enter a valid login alias or leave it blank.");
  return normalized;
}

export function maskEmail(value: string) {
  const [local, domain] = value.trim().split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}
export function maskPhone(value: string) {
  const normalized = normalizePhone(value);
  return normalized ? `***${normalized.slice(-4)}` : "";
}
function similarName(left: string, right: string) {
  if (!left || !right || left === right) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 3 && (longer.includes(shorter) || shorter.split(" ").filter(Boolean).some((token) => token.length >= 3 && longer.split(" ").includes(token)));
}

export function previewPreregistrationCollisions(accounts: ParentAccount[], input: PreregistrationInput) {
  const normalized = validatePreregistrationInput(input);
  const nameKey = normalizeIdentityValue(normalized.studentName);
  return accounts.flatMap((account): PreregistrationCollision[] => {
    const kinds: CollisionKind[] = [];
    const accountName = normalizeIdentityValue(account.studentName);
    if (accountName === nameKey) kinds.push("exact_name");
    else if (similarName(accountName, nameKey)) kinds.push("similar_name");
    if (normalized.email && normalizeIdentityValue(account.email) === normalized.email) kinds.push("email");
    if (normalized.phone && normalizePhone(account.phone) === normalized.phone) kinds.push("phone");
    if (normalized.loginAlias && normalizeIdentityValue(account.loginAlias ?? "") === normalized.loginAlias) kinds.push("login_alias");
    return kinds.length ? [{ accountId: account.id, studentName: account.studentName, kinds, maskedEmail: maskEmail(account.email), maskedPhone: maskPhone(account.phone), status: account.profileSetupRequired ? "setup_required" : account.confirmed ? "active" : "unconfirmed" }] : [];
  });
}

export function creationDecision(collisions: PreregistrationCollision[], input: PreregistrationInput, reviewedSameName: boolean) {
  const normalized = validatePreregistrationInput(input);
  if (collisions.some((item) => item.kinds.includes("email"))) return { blocked: true, reason: "email" } as const;
  if (collisions.some((item) => item.kinds.includes("login_alias"))) return { blocked: true, reason: "login_alias" } as const;
  if (collisions.some((item) => item.kinds.includes("exact_name") && item.kinds.includes("phone"))) return { blocked: true, reason: "name_contact" } as const;
  const exactName = collisions.some((item) => item.kinds.includes("exact_name"));
  if (exactName && !normalized.email && !normalized.phone && !normalized.loginAlias) return { blocked: true, reason: "name_only" } as const;
  if (exactName && !reviewedSameName) return { blocked: true, reason: "same_name_review" } as const;
  return { blocked: false, reason: "allowed" } as const;
}

export async function searchClubStudents(query: string, clubIdentifier: string, legacyClubProof: string): Promise<StudentSearchResponse> {
  const normalizedQuery = normalizeIdentityValue(query);
  if (!normalizedQuery) throw new Error("Search for an existing student first.");
  const { data, error } = await supabase.rpc("club_search_students", { p_club_identifier: clubIdentifier, p_club_proof: legacyClubProof, p_client_key: preregistrationClientKey(), p_query: normalizedQuery });
  if (error) throw error;
  return data as StudentSearchResponse;
}

export async function previewClubPreregistration(input: PreregistrationInput, requestKey: string, clubIdentifier: string, legacyClubProof: string): Promise<PreregistrationPreview> {
  const normalized = validatePreregistrationInput(input);
  const { data, error } = await supabase.rpc("club_preview_student_preregistration_v2", { p_club_identifier: clubIdentifier, p_club_proof: legacyClubProof, p_client_key: preregistrationClientKey(), p_request_key: requestKey, p_input: normalized });
  if (error) throw error;
  return data as PreregistrationPreview;
}

export async function createClubPreregistration(input: PreregistrationInput, preview: PreregistrationPreview, search: StudentSearchResponse, requestKey: string, reviewedSameName: boolean, clubIdentifier: string, legacyClubProof: string): Promise<PreregistrationResult> {
  const normalized = validatePreregistrationInput(input);
  const { data, error } = await supabase.rpc("club_preregister_student_v3", { p_club_identifier: clubIdentifier, p_club_proof: legacyClubProof, p_client_key: preregistrationClientKey(), p_request_key: requestKey, p_search_query: search.normalizedQuery, p_search_snapshot_hash: search.snapshotHash, p_input: normalized, p_duplicate_snapshot_hash: preview.snapshotHash, p_reviewed_same_name: reviewedSameName });
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
