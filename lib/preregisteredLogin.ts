export type PreregisteredLoginCandidate = {
  id: string;
  studentName: string;
  loginAlias?: string;
  email?: string;
  phone?: string;
};

export type PreregisteredLoginResolution = {
  normalizedIdentifier: string;
  exactMatches: PreregisteredLoginCandidate[];
  selected?: PreregisteredLoginCandidate;
  status: "unique_exact" | "ambiguous" | "no_match";
};

export function normalizePreregisteredLogin(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function resolvePreregisteredLogin(
  candidates: PreregisteredLoginCandidate[],
  identifier: string
): PreregisteredLoginResolution {
  const normalizedIdentifier = normalizePreregisteredLogin(identifier);
  if (!normalizedIdentifier || normalizedIdentifier.includes("@")) {
    return { normalizedIdentifier, exactMatches: [], status: "no_match" };
  }

  const exactMatches = candidates.filter((candidate) => {
    const alias = normalizePreregisteredLogin(candidate.loginAlias);
    const fullName = normalizePreregisteredLogin(candidate.studentName);
    return alias === normalizedIdentifier || fullName === normalizedIdentifier;
  });

  if (exactMatches.length === 1) {
    return { normalizedIdentifier, exactMatches, selected: exactMatches[0], status: "unique_exact" };
  }
  if (exactMatches.length > 1) {
    return { normalizedIdentifier, exactMatches, status: "ambiguous" };
  }
  return { normalizedIdentifier, exactMatches, status: "no_match" };
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 4))}@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (!digits) return "";
  return `•••-•••-${digits.slice(-4).padStart(4, "•")}`;
}

export function maskedPreregisteredContact(candidate: Pick<PreregisteredLoginCandidate, "email" | "phone">) {
  return maskEmail(String(candidate.email ?? "").trim()) || maskPhone(String(candidate.phone ?? "").trim());
}
