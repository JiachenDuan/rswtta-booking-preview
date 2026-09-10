import { supabase } from "@/lib/supabase";
import { assertParentCancellationAllowed } from "@/lib/cancellationPolicy";
import { canonicalizeStudentReference, prepareStudentReferenceForCreation, studentReferenceBelongsToAccount } from "@/lib/studentIdentity";
import type { ActivityLog, BillNotification, Booking, BookingStatus, ParentAccount } from "@/lib/types";

const projectSlug = "rswtta-booking";
const projectName = "Rising Stars World Table Tennis Academy";

const tableDefinitions = {
  bookings: [
    ["studentAccountId", "text"],
    ["studentName", "text"],
    ["studentEmail", "text"],
    ["phone", "text"],
    ["requestedCoach", "text"],
    ["assignedCoach", "text"],
    ["program", "text"],
    ["dateLabel", "text"],
    ["timeLabel", "text"],
    ["startsAt", "datetime"],
    ["priceCents", "number"],
    ["status", "text"],
    ["parentNote", "text"]
  ],
  parent_accounts: [
    ["preregisteredName", "text"],
    ["studentName", "text"],
    ["parentName", "text"],
    ["email", "text"],
    ["phone", "text"],
    ["passwordHash", "text"],
    ["passwordSalt", "text"],
    ["confirmationCode", "text"],
    ["confirmed", "boolean"],
    ["profileSetupRequired", "boolean"]
  ],
  bill_notifications: [
    ["studentAccountId", "text"],
    ["studentName", "text"],
    ["familyName", "text"],
    ["classCount", "number"],
    ["amountCents", "number"],
    ["message", "text"]
  ],
  activity_logs: [
    ["action", "text"],
    ["message", "text"],
    ["studentName", "text"],
    ["coach", "text"],
    ["dateLabel", "text"],
    ["timeLabel", "text"],
    ["count", "number"]
  ]
} as const;

type Project = {
  id: string;
  slug: string;
  name: string;
};

type ProjectTable = {
  id: string;
  project_id: string;
  slug: keyof typeof tableDefinitions;
  name: string;
};

type ProjectRow<T> = {
  id: string;
  project_table_id: string;
  values: Partial<T>;
  created_at: string;
  updated_at: string;
};

let schemaPromise: Promise<Record<keyof typeof tableDefinitions, string>> | null = null;
const localStoreKey = "rswtta-local-data";

export const preregisteredStudentNames = [
  "Abinav",
  "Adi",
  "Advik",
  "Akash",
  "Alex",
  "Andrew",
  "Angie",
  "Ayden",
  "Brandon",
  "Bryan",
  "Chen",
  "Dan",
  "Dan Rosenthal",
  "Daria",
  "Derek",
  "Desmond",
  "Dian",
  "Dylan",
  "Eddie",
  "Ela",
  "Elijah",
  "Ella",
  "Felix",
  "Han Xi",
  "Helen",
  "Joshua",
  "Kayden",
  "Kelsi",
  "Kyson",
  "Leo",
  "Li",
  "Luke",
  "Lyon",
  "Max",
  "Maya",
  "Melvin",
  "Nike",
  "Oaur",
  "Pat",
  "Pavani",
  "Rhoy",
  "Rishaan",
  "Shan",
  "Siva",
  "Stanley",
  "Suheng",
  "Tanish",
  "Vanya",
  "Vishal",
  "Wang",
  "William",
  "Yajia"
] as const;

const preregisteredPasswordTemplate = ["rs", "wt", "ta"].join("");

type AccountValues = ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string; profileSetupRequired: boolean };
type LocalRowMap = {
  bookings: Array<ProjectRow<Booking>>;
  parent_accounts: Array<ProjectRow<AccountValues>>;
  bill_notifications: Array<ProjectRow<BillNotification>>;
  activity_logs: Array<ProjectRow<ActivityLog>>;
};

function emptyLocalStore(): LocalRowMap {
  return {
    bookings: [],
    parent_accounts: [],
    bill_notifications: [],
    activity_logs: []
  };
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocalStore(): LocalRowMap {
  if (!isBrowser()) return emptyLocalStore();
  const raw = window.localStorage.getItem(localStoreKey);
  if (!raw) return emptyLocalStore();

  try {
    return { ...emptyLocalStore(), ...(JSON.parse(raw) as Partial<LocalRowMap>) };
  } catch {
    return emptyLocalStore();
  }
}

function writeLocalStore(store: LocalRowMap) {
  if (!isBrowser()) return;
  window.localStorage.setItem(localStoreKey, JSON.stringify(store));
}

function makeLocalRow<T>(values: Partial<T>): ProjectRow<T> {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    project_table_id: "local",
    values,
    created_at: now,
    updated_at: now
  };
}

function localRows<T>(tableSlug: keyof typeof tableDefinitions) {
  return readLocalStore()[tableSlug] as Array<ProjectRow<T>>;
}

function createLocalRow<T extends Record<string, unknown>>(tableSlug: keyof typeof tableDefinitions, values: T) {
  const store = readLocalStore();
  const row = makeLocalRow<T>(values);
  (store[tableSlug] as Array<ProjectRow<T>>).push(row);
  writeLocalStore(store);
  return row;
}

function updateLocalRow<T extends Record<string, unknown>>(tableSlug: keyof typeof tableDefinitions, id: string, values: T) {
  const store = readLocalStore();
  const rows = store[tableSlug] as Array<ProjectRow<T>>;
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) throw new Error("Row not found");
  rows[index] = {
    ...rows[index],
    values,
    updated_at: new Date().toISOString()
  };
  writeLocalStore(store);
  return rows[index];
}

function shouldSkipLocalFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("More than one student has this first name") ||
    message.includes("A student with this first name already exists") ||
    message.includes("This account is already set up") ||
    message.includes("Use email/password") ||
    message.includes("Email already used by another student") ||
    message.includes("Student name already has an account")
  );
}

async function withLocalFallback<T>(remoteAction: () => Promise<T>, localAction: () => T | Promise<T>) {
  try {
    return await remoteAction();
  } catch (error) {
    if (shouldSkipLocalFallback(error)) throw error;
    return localAction();
  }
}

function setupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`数据库暂时不可用 / Database temporarily unavailable. ${message}`);
}

async function selectOrInsertProject(): Promise<Project> {
  const existing = await supabase.from("projects").select("id, slug, name").eq("slug", projectSlug).maybeSingle();
  if (existing.error) throw setupError(existing.error.message);
  if (existing.data) return existing.data as Project;

  const created = await supabase.from("projects").insert({ slug: projectSlug, name: projectName }).select("id, slug, name").single();
  if (created.error) {
    const retry = await supabase.from("projects").select("id, slug, name").eq("slug", projectSlug).maybeSingle();
    if (retry.error || !retry.data) throw setupError(created.error.message);
    return retry.data as Project;
  }
  return created.data as Project;
}

async function selectOrInsertTable(projectId: string, slug: keyof typeof tableDefinitions) {
  const existing = await supabase.from("project_tables").select("id, project_id, slug, name").eq("project_id", projectId).eq("slug", slug).maybeSingle();
  if (existing.error) throw setupError(existing.error.message);
  if (existing.data) return existing.data as ProjectTable;

  const name = slug.replaceAll("_", " ");
  const created = await supabase.from("project_tables").insert({ project_id: projectId, slug, name }).select("id, project_id, slug, name").single();
  if (created.error) {
    const retry = await supabase.from("project_tables").select("id, project_id, slug, name").eq("project_id", projectId).eq("slug", slug).maybeSingle();
    if (retry.error || !retry.data) throw setupError(created.error.message);
    return retry.data as ProjectTable;
  }
  return created.data as ProjectTable;
}

async function ensureColumns(table: ProjectTable) {
  const definitions = tableDefinitions[table.slug];
  const existing = await supabase.from("project_columns").select("slug").eq("project_table_id", table.id);
  if (existing.error) throw setupError(existing.error.message);

  const existingSlugs = new Set((existing.data ?? []).map((column) => String(column.slug)));
  const missingDefinitions = definitions.filter(([slug]) => !existingSlugs.has(slug));
  if (missingDefinitions.length === 0) return;

  await Promise.all(
    missingDefinitions.map(([slug, dataType]) => {
      const index = definitions.findIndex(([definitionSlug]) => definitionSlug === slug);
      return (
      supabase
        .from("project_columns")
        .insert({
          project_table_id: table.id,
          slug,
          name: slug,
          data_type: dataType,
          sort_order: index
        })
        .then(({ error }) => {
          if (error && error.code !== "23505") throw setupError(error.message);
        })
      );
    })
  );
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const project = await selectOrInsertProject();
      const entries = await Promise.all(
        (Object.keys(tableDefinitions) as Array<keyof typeof tableDefinitions>).map(async (slug) => {
          const table = await selectOrInsertTable(project.id, slug);
          await ensureColumns(table);
          return [slug, table.id] as const;
        })
      );
      return Object.fromEntries(entries) as Record<keyof typeof tableDefinitions, string>;
    })();
  }
  return schemaPromise;
}

function studentNameKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueAccountRowsById(rows: Array<ProjectRow<AccountValues>>) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function normalizeCoachName(value: unknown) {
  const coach = String(value ?? "Coach A").trim();
  if (coach === "Coach A" || coach === "National A" || coach === "Debolina" || coach === "Coach Debolina") return "National A";
  if (coach === "Coach B" || coach === "National B" || coach === "Diren" || coach === "Coach Diren") return "National B";
  return coach;
}

function accountFromRow(row: ProjectRow<ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string }>): ParentAccount {
  return {
    id: row.id,
    preregisteredName: String(row.values.preregisteredName ?? "") || undefined,
    studentName: String(row.values.studentName ?? "Student"),
    parentName: String(row.values.parentName ?? ""),
    email: String(row.values.email ?? ""),
    phone: String(row.values.phone ?? ""),
    confirmed: Boolean(row.values.confirmed),
    profileSetupRequired: Boolean(row.values.profileSetupRequired),
    createdAt: row.created_at
  };
}

function bookingFromRow(row: ProjectRow<Booking>): Booking {
  return {
    id: row.id,
    studentAccountId: String(row.values.studentAccountId ?? "") || undefined,
    studentName: String(row.values.studentName ?? "Student"),
    familyName: String(row.values.familyName ?? row.values.studentName ?? "Student"),
    studentEmail: String(row.values.studentEmail ?? ""),
    phone: String(row.values.phone ?? ""),
    requestedCoach: normalizeCoachName(row.values.requestedCoach ?? row.values.assignedCoach ?? "National A"),
    assignedCoach: normalizeCoachName(row.values.assignedCoach ?? row.values.requestedCoach ?? "National A"),
    program: String(row.values.program ?? "Private lesson"),
    dateLabel: String(row.values.dateLabel ?? "Today"),
    timeLabel: String(row.values.timeLabel ?? "4:30 PM"),
    startsAt: String(row.values.startsAt ?? new Date().toISOString()),
    priceCents: Number(row.values.priceCents ?? 0),
    status: String(row.values.status ?? "requested") as BookingStatus,
    parentNote: String(row.values.parentNote ?? ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function billFromRow(row: ProjectRow<BillNotification>): BillNotification {
  return {
    id: row.id,
    studentAccountId: String(row.values.studentAccountId ?? "") || undefined,
    studentName: String(row.values.studentName ?? "Student"),
    familyName: String(row.values.familyName ?? row.values.studentName ?? "Student"),
    classCount: Number(row.values.classCount ?? 0),
    amountCents: Number(row.values.amountCents ?? 0),
    message: String(row.values.message ?? ""),
    createdAt: row.created_at
  };
}

function activityLogFromRow(row: ProjectRow<ActivityLog>): ActivityLog {
  return {
    id: row.id,
    action: String(row.values.action ?? "activity"),
    message: String(row.values.message ?? ""),
    studentName: String(row.values.studentName ?? ""),
    coach: normalizeCoachName(row.values.coach ?? ""),
    dateLabel: String(row.values.dateLabel ?? ""),
    timeLabel: String(row.values.timeLabel ?? ""),
    count: Number(row.values.count ?? 1),
    createdAt: row.created_at
  };
}

async function listRows<T>(tableSlug: keyof typeof tableDefinitions) {
  const tables = await ensureSchema();
  const pageSize = 1000;
  const allRows: Array<ProjectRow<T>> = [];

  for (let from = 0; from < 10000; from += pageSize) {
    const response = await supabase
      .from("project_rows")
      .select("id, project_table_id, values, created_at, updated_at")
      .eq("project_table_id", tables[tableSlug])
      .range(from, from + pageSize - 1);
    if (response.error) throw setupError(response.error.message);

    const page = (response.data ?? []) as Array<ProjectRow<T>>;
    allRows.push(...page);
    if (page.length < pageSize) break;
  }

  return allRows;
}

async function createRow<T extends Record<string, unknown>>(tableSlug: keyof typeof tableDefinitions, values: T) {
  const tables = await ensureSchema();
  const response = await supabase
    .from("project_rows")
    .insert({ project_table_id: tables[tableSlug], values })
    .select("id, project_table_id, values, created_at, updated_at")
    .single();
  if (response.error) throw setupError(response.error.message);
  return response.data as ProjectRow<T>;
}

async function updateRow<T extends Record<string, unknown>>(tableSlug: keyof typeof tableDefinitions, id: string, values: T) {
  const tables = await ensureSchema();
  const response = await supabase
    .from("project_rows")
    .update({ values })
    .eq("project_table_id", tables[tableSlug])
    .eq("id", id)
    .select("id, project_table_id, values, created_at, updated_at")
    .single();
  if (response.error) throw setupError(response.error.message);
  return response.data as ProjectRow<T>;
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return {
    salt: bytesToBase64(salt),
    hash: bytesToBase64(new Uint8Array(bits))
  };
}

async function verifyPassword(password: string, saltBase64: string, expectedHash: string) {
  const salt = Uint8Array.from(atob(saltBase64), (char) => char.charCodeAt(0));
  const { hash } = await hashPassword(password, salt);
  return hash === expectedHash;
}

async function seedPreregisteredAccounts(rows: Array<ProjectRow<AccountValues>>, create: (values: AccountValues) => Promise<ProjectRow<AccountValues>> | ProjectRow<AccountValues>) {
  const existingNames = new Set(
    rows.flatMap((row) => [row.values.studentName, row.values.preregisteredName]).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)
  );
  const password = await hashPassword(preregisteredPasswordTemplate);
  const created: Array<ProjectRow<AccountValues>> = [];

  for (const studentName of preregisteredStudentNames) {
    if (existingNames.has(studentName.toLowerCase())) continue;
    const row = await create({
      id: "",
      preregisteredName: studentName,
      studentName,
      parentName: "",
      email: "",
      phone: "",
      passwordHash: password.hash,
      passwordSalt: password.salt,
      confirmationCode: "",
      confirmed: true,
      profileSetupRequired: true,
      createdAt: ""
    });
    created.push(row);
    existingNames.add(studentName.toLowerCase());
  }

  return rows.concat(created);
}

async function listAccountRowsWithSeeds() {
  return withLocalFallback(
    () => listRows<AccountValues>("parent_accounts"),
    async () => {
      const rows = localRows<AccountValues>("parent_accounts");
      return seedPreregisteredAccounts(rows, (values) => createLocalRow("parent_accounts", values));
    }
  );
}

export async function registerParentAccount(input: { studentName: string; email: string; phone: string; password: string }) {
  return withLocalFallback(
    async () => {
      const email = input.email.toLowerCase();
      const authResult = await supabase.auth.signUp({
        email,
        password: input.password,
        options: {
          data: {
            student_name: input.studentName,
            phone: input.phone
          }
        }
      });
      if (authResult.error && !authResult.error.message.toLowerCase().includes("already")) {
        console.warn("Supabase Auth sign-up unavailable; storing preview account row only.", authResult.error.message);
      }

      const rows = await listRows<AccountValues>("parent_accounts");
      const bookingRows = await listRows<Booking>("bookings");
      assertNoDuplicateFirstNameForNewAccount(rows, bookingRows, input.studentName);
      const nameKey = studentNameKey(input.studentName);
      const duplicateName = rows.find((row) => studentNameKey(row.values.studentName) === nameKey && String(row.values.email ?? "").toLowerCase() !== email);
      if (duplicateName) throw new Error("Student name already has an account");
      const existing = rows.find((row) => String(row.values.email ?? "").toLowerCase() === email);
      if (existing) {
        if (!existing.values.confirmed) {
          const updated = await updateRow("parent_accounts", existing.id, { ...existing.values, confirmed: true });
          return { account: accountFromRow(updated), alreadyExists: true };
        }
        return { account: accountFromRow(existing), alreadyExists: true };
      }

      const password = await hashPassword(input.password);
      const row = await createRow("parent_accounts", {
        studentName: input.studentName,
        email,
        phone: input.phone,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        confirmationCode: "",
        confirmed: true,
        profileSetupRequired: false
      });
      return { account: accountFromRow(row), alreadyExists: false };
    },
    async () => {
      const email = input.email.toLowerCase();
      const rows = localRows<AccountValues>("parent_accounts");
      const bookingRows = localRows<Booking>("bookings");
      assertNoDuplicateFirstNameForNewAccount(rows, bookingRows, input.studentName);
      const nameKey = studentNameKey(input.studentName);
      const duplicateName = rows.find((row) => studentNameKey(row.values.studentName) === nameKey && String(row.values.email ?? "").toLowerCase() !== email);
      if (duplicateName) throw new Error("Student name already has an account");
      const existing = rows.find((row) => String(row.values.email ?? "").toLowerCase() === email);
      if (existing) {
        const updated = updateLocalRow("parent_accounts", existing.id, { ...existing.values, confirmed: true });
        return { account: accountFromRow(updated), alreadyExists: true };
      }

      const password = await hashPassword(input.password);
      const row = createLocalRow("parent_accounts", {
        studentName: input.studentName,
        email,
        phone: input.phone,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        confirmationCode: "",
        confirmed: true,
        profileSetupRequired: false
      });
      return { account: accountFromRow(row), alreadyExists: false };
    }
  );
}

export async function confirmParentAccount(email: string, confirmationCode: string) {
  const rows = await listRows<ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string }>("parent_accounts");
  const row = rows.find(
    (item) => String(item.values.email ?? "").toLowerCase() === email.toLowerCase() && item.values.confirmationCode === confirmationCode
  );
  if (!row) throw new Error("Invalid confirmation code");
  const updated = await updateRow("parent_accounts", row.id, { ...row.values, confirmed: true });
  return accountFromRow(updated);
}

function accountNameTokens(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function findPreregisteredNameMatches(rows: Array<ProjectRow<AccountValues>>, identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const identifierFirstName = accountNameTokens(normalizedIdentifier)[0] ?? "";
  if (!identifierFirstName) return [];
  return rows.filter((item) => {
    const studentName = String(item.values.studentName ?? "").trim().toLowerCase();
    const firstName = accountNameTokens(studentName)[0] ?? "";
    return studentName === normalizedIdentifier || firstName === identifierFirstName;
  });
}

function normalizedRosterName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesFirstName(name: unknown, identifier: string) {
  const normalizedName = normalizedRosterName(name);
  const normalizedIdentifier = normalizedRosterName(identifier);
  if (!normalizedName || normalizedName === "group class") return false;
  const identifierFirstName = accountNameTokens(normalizedIdentifier)[0] ?? "";
  const firstName = accountNameTokens(normalizedName)[0] ?? "";
  return Boolean(identifierFirstName) && (normalizedName === normalizedIdentifier || firstName === identifierFirstName);
}

function assertUniquePreregisteredRosterName(accountRows: Array<ProjectRow<AccountValues>>, bookingRows: Array<ProjectRow<Booking>>, identifier: string) {
  const accountMatches = accountRows.filter((item) => matchesFirstName(item.values.studentName, identifier));
  const uniqueAccountNames = new Set(accountMatches.map((item) => normalizedRosterName(item.values.studentName)).filter(Boolean));
  const uniqueBookingNames = new Set(
    bookingRows.map((item) => normalizedRosterName(item.values.studentName)).filter((name) => matchesFirstName(name, identifier))
  );
  const uniqueRosterNames = new Set([...uniqueAccountNames, ...uniqueBookingNames]);
  if (uniqueRosterNames.size > 1) {
    throw new Error("More than one student has this first name. Please log in with email.");
  }
}

function assertNoDuplicateFirstNameForNewAccount(accountRows: Array<ProjectRow<AccountValues>>, bookingRows: Array<ProjectRow<Booking>>, studentName: string) {
  const hasMatch =
    accountRows.some((item) => matchesFirstName(item.values.studentName, studentName)) ||
    bookingRows.some((item) => matchesFirstName(item.values.studentName, studentName));
  if (hasMatch) throw new Error("A student with this first name already exists. Please use the existing account or log in with email.");
}

function selectParentLoginRow(rows: Array<ProjectRow<AccountValues>>, identifier: string, allowPreregisteredName: boolean) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const isEmail = normalizedIdentifier.includes("@");
  if (isEmail) {
    const row = rows.find((item) => String(item.values.email ?? "").trim().toLowerCase() === normalizedIdentifier);
    if (!row) throw new Error("Invalid login");
    return row;
  }

  if (!allowPreregisteredName) {
    throw new Error("Use email/password, or check Pre-registered student to use student name.");
  }

  const matches = findPreregisteredNameMatches(rows, normalizedIdentifier);
  if (matches.length === 0) throw new Error("Invalid login");
  const uniqueMatchNames = new Set(matches.map((item) => normalizedRosterName(item.values.studentName)).filter(Boolean));
  if (uniqueMatchNames.size > 1) throw new Error("More than one student has this first name. Please log in with email.");

  const row = matches.find((item) => item.values.profileSetupRequired || !String(item.values.email ?? "").includes("@")) ?? matches[0];
  if (!row.values.profileSetupRequired && String(row.values.email ?? "").includes("@")) {
    throw new Error("This account is already set up. Please log in with email and password.");
  }
  return row;
}

export async function loginParentAccount(identifier: string, password: string, options: { allowPreregisteredName?: boolean } = {}) {
  return withLocalFallback(
    async () => {
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const isEmail = normalizedIdentifier.includes("@");
      let authError: Error | null = null;
      if (isEmail) {
        const authResult = await supabase.auth.signInWithPassword({
          email: normalizedIdentifier,
          password
        });
        if (authResult.error) authError = authResult.error;
      }

      const rows = await listAccountRowsWithSeeds();
      if (!isEmail && options.allowPreregisteredName) {
        const bookingRows = await listRows<Booking>("bookings");
        assertUniquePreregisteredRosterName(rows, bookingRows, normalizedIdentifier);
      }
      const row = selectParentLoginRow(rows, normalizedIdentifier, Boolean(options.allowPreregisteredName));
      const ok = await verifyPassword(password, String(row.values.passwordSalt ?? ""), String(row.values.passwordHash ?? ""));
      if (!ok) throw authError ?? new Error("Invalid login");
      if (!row.values.confirmed) {
        const updated = await updateRow("parent_accounts", row.id, { ...row.values, confirmed: true });
        return accountFromRow(updated);
      }
      return accountFromRow(row);
    },
    async () => {
      const rows = await seedPreregisteredAccounts(localRows<AccountValues>("parent_accounts"), (values) => createLocalRow("parent_accounts", values));
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const isEmail = normalizedIdentifier.includes("@");
      if (!isEmail && options.allowPreregisteredName) {
        const bookingRows = localRows<Booking>("bookings");
        assertUniquePreregisteredRosterName(rows, bookingRows, normalizedIdentifier);
      }
      const row = selectParentLoginRow(rows, normalizedIdentifier, Boolean(options.allowPreregisteredName));
      const ok = await verifyPassword(password, String(row.values.passwordSalt ?? ""), String(row.values.passwordHash ?? ""));
      if (!ok) throw new Error("Invalid login");
      if (!row.values.confirmed) {
        const updated = updateLocalRow("parent_accounts", row.id, { ...row.values, confirmed: true });
        return accountFromRow(updated);
      }
      return accountFromRow(row);
    }
  );
}

export async function listParentAccounts() {
  const rows = await listAccountRowsWithSeeds();
  return uniqueAccountRowsById(rows).map(accountFromRow).sort((left, right) => left.studentName.localeCompare(right.studentName));
}

export async function createClubStudentAccount(input: { studentName: string; email?: string; phone?: string }) {
  const studentName = input.studentName.trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const phone = String(input.phone ?? "").trim();
  if (!studentName) throw new Error("Student name is required");

  const password = await hashPassword(preregisteredPasswordTemplate);
  const values: AccountValues = {
    id: "",
    studentName,
    parentName: "",
    email,
    phone,
    passwordHash: password.hash,
    passwordSalt: password.salt,
    confirmationCode: "",
    confirmed: true,
    profileSetupRequired: !email.includes("@") || phone.length < 7,
    createdAt: ""
  };

  const row = await withLocalFallback(
    async () => {
      const rows = await listRows<AccountValues>("parent_accounts");
      const nameKey = studentNameKey(studentName);
      const existing = rows.find((item) =>
        studentNameKey(item.values.studentName) === nameKey ||
        (email && String(item.values.email ?? "").trim().toLowerCase() === email) ||
        (phone && String(item.values.phone ?? "").trim() === phone)
      );
      if (existing) return existing;
      return createRow<AccountValues>("parent_accounts", values);
    },
    () => {
      const rows = localRows<AccountValues>("parent_accounts");
      const nameKey = studentNameKey(studentName);
      const existing = rows.find((item) =>
        studentNameKey(item.values.studentName) === nameKey ||
        (email && String(item.values.email ?? "").trim().toLowerCase() === email) ||
        (phone && String(item.values.phone ?? "").trim() === phone)
      );
      if (existing) return existing;
      return createLocalRow<AccountValues>("parent_accounts", values);
    }
  );

  return accountFromRow(row);
}

export async function resetPasswordForEmail(email: string) {
  const redirectTo = "https://rswtta-booking-preview.vercel.app/";
  const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
    redirectTo
  });
  if (error) throw error;
}

export async function updateUserPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email) return;

  try {
    const passwordParts = await hashPassword(password);
    const rows = await listRows<AccountValues>("parent_accounts");
    const row = rows.find((item) => String(item.values.email ?? "").toLowerCase() === email);
    if (row) {
      await updateRow("parent_accounts", row.id, {
        ...row.values,
        passwordHash: passwordParts.hash,
        passwordSalt: passwordParts.salt,
        confirmed: true,
        profileSetupRequired: false
      });
    }
  } catch {
    const rows = localRows<AccountValues>("parent_accounts");
    const row = rows.find((item) => String(item.values.email ?? "").toLowerCase() === email);
    if (!row) return;
    const passwordParts = await hashPassword(password);
    updateLocalRow("parent_accounts", row.id, {
      ...row.values,
      passwordHash: passwordParts.hash,
      passwordSalt: passwordParts.salt,
      confirmed: true,
      profileSetupRequired: false
    });
  }
}

async function updateStudentAccountAndReferences(accountId: string, values: Partial<AccountValues>) {
  const response = await supabase
    .rpc("rename_student_account", { p_account_id: accountId, p_values: values })
    .select("id, project_table_id, values, created_at, updated_at")
    .single();
  if (response.error) {
    throw setupError(`Student profile update was rolled back. ${response.error.message}`);
  }
  return response.data as ProjectRow<AccountValues>;
}

export async function updateParentAccount(input: { accountId: string; studentName: string; parentName?: string; email: string; phone: string }) {
  const normalizedStudentName = input.studentName.trim();
  const normalizedParentName = String(input.parentName ?? "").trim();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone.trim();
  if (!normalizedStudentName || !normalizedEmail.includes("@") || normalizedPhone.length < 7) {
    throw new Error("Student name, email, and phone are required");
  }

  const values = {
    studentName: normalizedStudentName,
    parentName: normalizedParentName,
    email: normalizedEmail,
    phone: normalizedPhone
  };

  const row = await updateStudentAccountAndReferences(input.accountId, values);
  return accountFromRow(row);
}

export async function completeParentProfileSetup(input: { accountId: string; studentName?: string; parentName?: string; email: string; phone: string; password: string }) {
  const normalizedStudentName = String(input.studentName ?? "").trim();
  const normalizedParentName = String(input.parentName ?? "").trim();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone.trim();
  if (!normalizedStudentName || !normalizedEmail.includes("@") || normalizedPhone.length < 7 || input.password.length < 6 || input.password === preregisteredPasswordTemplate) {
    throw new Error("Student name, email, phone, and a new password are required");
  }

  const passwordParts = await hashPassword(input.password);
  const values = {
    studentName: normalizedStudentName,
    parentName: normalizedParentName,
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash: passwordParts.hash,
    passwordSalt: passwordParts.salt,
    confirmed: true,
    profileSetupRequired: false
  };

  const accountRows = await listRows<AccountValues>("parent_accounts");
  const existing = accountRows.find((item) => item.id === input.accountId);
  if (!existing) throw new Error("Account not found");
  const bookingRows = await listRows<Booking>("bookings");
  assertUniquePreregisteredRosterName(accountRows, bookingRows, String(existing.values.studentName ?? ""));

  const row = await updateStudentAccountAndReferences(input.accountId, values);
  return accountFromRow(row);
}


export const recurringStudentAccountIds = {
  Abinav: "e46f4a6e-4f15-4cac-8b7f-b56efbf0bb34",
  Adi: "a0324572-db54-4f40-a2fb-8a69f1acbe85",
  Advik: "3a5d55f4-65b7-4a50-b468-874ff39af1ad",
  Alex: "9bed3c27-3e60-4a78-be48-fbb40430cf0c",
  Angie: "36cee43b-4aa0-4e0f-9e5d-73133dd156b2",
  Ayden: "f48731af-a7a9-4d33-942a-05e6a8e707b7",
  Chen: "136a5ebc-0f03-478d-ab03-ad2654b0bacb",
  Daria: "bb04312b-5d2e-4684-bed7-4a4ed7d1f4d0",
  Derek: "cdaa204c-9e82-4ecd-bd1c-3e2556998339",
  Desmond: "24cea930-8629-4eb9-a7a5-6829efabdb96",
  Elijah: "fa748b5b-6b7d-4f3b-9b3b-f44328e7f63f",
  Ella: "b8433b38-75f0-4e37-8792-3b952d26c74d",
  "Han Xi": "0f183233-b47f-4cbf-84ad-e38074fdc20e",
  Kyson: "bdaac62c-8f13-4426-bca1-fc8ac7d2a7f9",
  Luke: "9f04c65b-d514-4d17-b407-d57b043964e8",
  Max: "ca9d21a4-bd28-4072-b13b-f83ecf9d6dee",
  Maya: "717026bf-fb61-4ecb-99c4-671c6662d0dc",
  Nike: "3a58db57-4a9a-45ca-b220-c10dbb4771d5",
  Rhoy: "4bd9e722-6fbe-4e89-8f7e-569373300e88",
  Rishaan: "4bb76513-7572-45d8-8b89-f74eeb9477cf",
  Shan: "be602cde-a725-4ced-b184-d2a5964579cf",
  Siva: "09257ad4-1757-4055-a75f-cd7934185f26",
  Stanley: "6b91263d-5f60-49c8-bc49-9318d56b8094",
  Vanya: "0252b9a2-bfa1-4c21-b873-5ea73fe324b4",
  Vishal: "b0b024a3-a9e9-4e62-bf58-413e8f641357",
  Yajia: "8b98dd5d-aa83-47bb-8e86-85c2b9f21822"
} as const;

type RecurringClassSeed = {
  studentName: keyof typeof recurringStudentAccountIds;
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  source: string;
  note?: string;
};

const tianYeRecurringClassSeeds: RecurringClassSeed[] = [
  { studentName: "Vishal", day: 1, startHour: 16, startMinute: 0, endHour: 17, endMinute: 30, source: "TIAN YE G2/G3" },
  { studentName: "Ella", day: 1, startHour: 18, startMinute: 0, endHour: 19, endMinute: 0, source: "TIAN YE I2/I3" },
  { studentName: "Kyson", day: 1, startHour: 19, startMinute: 0, endHour: 20, endMinute: 30, source: "TIAN YE J2/J3" },
  { studentName: "Luke", day: 3, startHour: 15, startMinute: 30, endHour: 16, endMinute: 30, source: "TIAN YE H8/H9" },
  { studentName: "Derek", day: 3, startHour: 16, startMinute: 30, endHour: 17, endMinute: 30, source: "TIAN YE I8/I9" },
  { studentName: "Yajia", day: 3, startHour: 17, startMinute: 30, endHour: 18, endMinute: 30, source: "TIAN YE J8/J9" },
  { studentName: "Abinav", day: 3, startHour: 18, startMinute: 30, endHour: 19, endMinute: 30, source: "TIAN YE K8/K9" },
  { studentName: "Kyson", day: 3, startHour: 19, startMinute: 30, endHour: 20, endMinute: 30, source: "TIAN YE L8/L9" },
  { studentName: "Shan", day: 4, startHour: 16, startMinute: 30, endHour: 17, endMinute: 30, source: "TIAN YE I11/I12", note: "Sheet cell included the time after Shan." },
  { studentName: "Angie", day: 4, startHour: 17, startMinute: 30, endHour: 18, endMinute: 30, source: "TIAN YE J11/J12" },
  { studentName: "Alex", day: 4, startHour: 18, startMinute: 30, endHour: 19, endMinute: 0, source: "TIAN YE K11/K12" },
  { studentName: "Rishaan", day: 4, startHour: 19, startMinute: 0, endHour: 20, endMinute: 0, source: "TIAN YE L11/L12" },
  { studentName: "Luke", day: 5, startHour: 15, startMinute: 30, endHour: 16, endMinute: 30, source: "TIAN YE H14/H15" },
  { studentName: "Vishal", day: 5, startHour: 16, startMinute: 30, endHour: 18, endMinute: 0, source: "TIAN YE I14/I15" },
  { studentName: "Kyson", day: 5, startHour: 19, startMinute: 0, endHour: 20, endMinute: 30, source: "TIAN YE K14/K15" },
  { studentName: "Rhoy", day: 5, startHour: 20, startMinute: 30, endHour: 21, endMinute: 30, source: "TIAN YE L14/L15" },
  { studentName: "Kyson", day: 6, startHour: 9, startMinute: 30, endHour: 11, endMinute: 0, source: "TIAN YE B17/B18" },
  { studentName: "Rishaan", day: 6, startHour: 11, startMinute: 0, endHour: 12, endMinute: 0, source: "TIAN YE C17/C18" },
  { studentName: "Max", day: 6, startHour: 13, startMinute: 30, endHour: 14, endMinute: 30, source: "TIAN YE F17/F18", note: "Cell says Max & Daria 1:30-2:30; imported as two students." },
  { studentName: "Daria", day: 6, startHour: 13, startMinute: 30, endHour: 14, endMinute: 30, source: "TIAN YE F17/F18", note: "Cell says Max & Daria 1:30-2:30; imported as two students." },
  { studentName: "Siva", day: 6, startHour: 15, startMinute: 30, endHour: 16, endMinute: 30, source: "TIAN YE H17/H18" },
  { studentName: "Kyson", day: 0, startHour: 14, startMinute: 0, endHour: 15, endMinute: 30, source: "TIAN YE I20/I21" },
  { studentName: "Alex", day: 0, startHour: 15, startMinute: 30, endHour: 16, endMinute: 0, source: "TIAN YE J20/J21" },
  { studentName: "Chen", day: 0, startHour: 16, startMinute: 0, endHour: 17, endMinute: 0, source: "TIAN YE K20/K21" },
  { studentName: "Han Xi", day: 0, startHour: 17, startMinute: 0, endHour: 18, endMinute: 0, source: "TIAN YE L20/L21" }
];

const coachJordenRecurringClassSeeds: RecurringClassSeed[] = [
  { studentName: "Vanya", day: 2, startHour: 19, startMinute: 30, endHour: 20, endMinute: 30, source: "wang H5/H6" },
  { studentName: "Alex", day: 3, startHour: 18, startMinute: 30, endHour: 19, endMinute: 30, source: "wang G8/G9" },
  { studentName: "Adi", day: 3, startHour: 19, startMinute: 30, endHour: 20, endMinute: 30, source: "wang H8/H9" },
  { studentName: "Nike", day: 5, startHour: 18, startMinute: 30, endHour: 19, endMinute: 30, source: "wang H14/H15" },
  { studentName: "Desmond", day: 5, startHour: 19, startMinute: 30, endHour: 20, endMinute: 30, source: "wang I14/I15" },
  { studentName: "Maya", day: 6, startHour: 10, startMinute: 30, endHour: 11, endMinute: 30, source: "wang C17/C18" },
  { studentName: "Adi", day: 6, startHour: 13, startMinute: 0, endHour: 14, endMinute: 0, source: "wang F17/F18" },
  { studentName: "Ayden", day: 6, startHour: 15, startMinute: 30, endHour: 16, endMinute: 30, source: "wang H17/H18" },
  { studentName: "Stanley", day: 6, startHour: 16, startMinute: 30, endHour: 17, endMinute: 30, source: "wang I17/I18" },
  { studentName: "Advik", day: 6, startHour: 17, startMinute: 30, endHour: 18, endMinute: 0, source: "wang J17/J18" },
  { studentName: "Desmond", day: 0, startHour: 14, startMinute: 30, endHour: 15, endMinute: 30, source: "wang E21/E22" },
  { studentName: "Elijah", day: 0, startHour: 15, startMinute: 30, endHour: 16, endMinute: 30, source: "wang F21/F22" },
  { studentName: "Ayden", day: 0, startHour: 16, startMinute: 30, endHour: 17, endMinute: 30, source: "wang G21/G22" }
];

function formatSeedDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatSeedTime(hour: number, minute: number) {
  const date = new Date(2026, 0, 1, hour, minute, 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date).replace(":00", "");
}

function nextDateForDay(start: Date, day: number) {
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  const offset = (day - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + offset);
  return date;
}

function bookingNaturalKey(values: Partial<Booking>) {
  const isSystemCalendarRow = values.program === "Unavailable" || values.program === "Group class";
  return [
    values.studentAccountId ? `account:${values.studentAccountId}` : isSystemCalendarRow ? `system:${values.program}` : "unresolved-legacy",
    normalizeCoachName(values.assignedCoach ?? values.requestedCoach ?? "").trim().toLowerCase(),
    String(values.startsAt ?? "").trim()
  ].join("|");
}

function isActiveBooking(values: Partial<Booking>) {
  return values.status !== "cancelled";
}

function sameBookingNaturalKey(left: Partial<Booking>, right: Partial<Booking>) {
  return bookingNaturalKey(left) === bookingNaturalKey(right);
}

function tianRecurringKey(values: Partial<Booking>) {
  return bookingNaturalKey(values);
}

function identityAccounts(accounts: Array<ProjectRow<AccountValues>>) {
  return accounts.map((row) => ({
    id: row.id,
    studentName: String(row.values.studentName ?? ""),
    preregisteredName: row.values.preregisteredName,
    email: String(row.values.email ?? ""),
    phone: String(row.values.phone ?? "")
  }));
}

function recurringSeedAccount(seed: RecurringClassSeed, accounts: Array<ProjectRow<AccountValues>>) {
  const accountId = recurringStudentAccountIds[seed.studentName];
  return accounts.find((row) => row.id === accountId);
}

function tianRecurringBookingValues(seed: RecurringClassSeed, date: Date, account: ProjectRow<AccountValues>): Booking {
  const starts = new Date(date);
  starts.setHours(seed.startHour, seed.startMinute, 0, 0);
  const studentName = String(account.values.studentName);
  return {
    id: "",
    studentAccountId: account.id,
    studentName,
    familyName: studentName,
    studentEmail: String(account.values.email ?? ""),
    phone: String(account.values.phone ?? ""),
    requestedCoach: "Coach Tian Ye",
    assignedCoach: "Coach Tian Ye",
    program: "Private lesson",
    dateLabel: formatSeedDateLabel(starts),
    timeLabel: `${formatSeedTime(seed.startHour, seed.startMinute)} - ${formatSeedTime(seed.endHour, seed.endMinute)}`,
    startsAt: starts.toISOString(),
    priceCents: 15000,
    status: "club_confirmed",
    parentNote: `Imported Coach Tian Ye recurring class from Excel (${seed.source}) through Dec 31, 2026.${seed.note ? ` ${seed.note}` : ""}`,
    createdAt: "",
    updatedAt: ""
  };
}


function coachJordenRecurringBookingValues(seed: RecurringClassSeed, date: Date, account: ProjectRow<AccountValues>): Booking {
  const starts = new Date(date);
  starts.setHours(seed.startHour, seed.startMinute, 0, 0);
  const studentName = String(account.values.studentName);
  return {
    id: "",
    studentAccountId: account.id,
    studentName,
    familyName: studentName,
    studentEmail: String(account.values.email ?? ""),
    phone: String(account.values.phone ?? ""),
    requestedCoach: "Coach Jorden",
    assignedCoach: "Coach Jorden",
    program: "Group lesson",
    dateLabel: formatSeedDateLabel(starts),
    timeLabel: `${formatSeedTime(seed.startHour, seed.startMinute)} - ${formatSeedTime(seed.endHour, seed.endMinute)}`,
    startsAt: starts.toISOString(),
    priceCents: 7500,
    status: "club_confirmed",
    parentNote: `Imported Coach Wang recurring class from Excel as Coach Jorden (${seed.source}) through Dec 31, 2026.${seed.note ? ` ${seed.note}` : ""}`,
    createdAt: "",
    updatedAt: ""
  };
}

function coachJordenRecurringBookingsThroughDec31(accounts: Array<ProjectRow<AccountValues>>) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(2026, 11, 31, 23, 59, 59, 999);
  const bookings: Booking[] = [];
  for (const seed of coachJordenRecurringClassSeeds) {
    const account = recurringSeedAccount(seed, accounts);
    if (!account) continue;
    for (let date = nextDateForDay(start, seed.day); date <= end; date.setDate(date.getDate() + 7)) {
      bookings.push(coachJordenRecurringBookingValues(seed, new Date(date), account));
    }
  }
  return bookings;
}

function seedCoachJordenRecurringBookings(rows: Array<ProjectRow<Booking>>, accounts: Array<ProjectRow<AccountValues>>) {
  return appendMissingRecurringBookings(rows, coachJordenRecurringBookingsThroughDec31(accounts));
}

function tianYeRecurringBookingsThroughDec31(accounts: Array<ProjectRow<AccountValues>>) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(2026, 11, 31, 23, 59, 59, 999);
  const bookings: Booking[] = [];
  for (const seed of tianYeRecurringClassSeeds) {
    const account = recurringSeedAccount(seed, accounts);
    if (!account) continue;
    for (let date = nextDateForDay(start, seed.day); date <= end; date.setDate(date.getDate() + 7)) {
      bookings.push(tianRecurringBookingValues(seed, new Date(date), account));
    }
  }
  return bookings;
}

function virtualBookingRow(booking: Booking): ProjectRow<Booking> {
  if (!booking.studentAccountId) throw new Error("Recurring class identity is unresolved");
  return {
    id: `virtual-${booking.assignedCoach}-${booking.studentAccountId}-${booking.startsAt}`.replace(/\s+/g, "-"),
    project_table_id: "virtual",
    values: booking,
    created_at: booking.startsAt,
    updated_at: booking.startsAt
  };
}

function appendMissingRecurringBookings(rows: Array<ProjectRow<Booking>>, bookings: Booking[]) {
  const existingKeys = new Set(rows.map((row) => tianRecurringKey(row.values)));
  const virtualRows: Array<ProjectRow<Booking>> = [];
  for (const booking of bookings) {
    const key = tianRecurringKey(booking);
    if (existingKeys.has(key)) continue;
    virtualRows.push(virtualBookingRow(booking));
    existingKeys.add(key);
  }
  return rows.concat(virtualRows);
}

function seedTianYeRecurringBookings(rows: Array<ProjectRow<Booking>>, accounts: Array<ProjectRow<AccountValues>>) {
  return appendMissingRecurringBookings(rows, tianYeRecurringBookingsThroughDec31(accounts));
}

function uniqueBookingRows(rows: Array<ProjectRow<Booking>>) {
  const byKey = new Map<string, ProjectRow<Booking>>();
  for (const row of rows) {
    const note = String(row.values.parentNote ?? "");
    const isRecurringImport = note.includes("Imported Coach Tian Ye recurring class from Excel") || note.includes("Imported Coach Wang recurring class from Excel as Coach Jorden");
    const key = isRecurringImport && row.values.studentAccountId
      ? `recurring-import|${row.values.assignedCoach ?? row.values.requestedCoach ?? ""}|${row.values.studentAccountId}|${row.values.startsAt ?? ""}`
      : row.id;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function canonicalBookingRows(rows: Array<ProjectRow<Booking>>, accounts: Array<ProjectRow<AccountValues>>) {
  const canonicalAccounts = identityAccounts(accounts);
  return rows.map((row) => ({ ...row, values: canonicalizeStudentReference(row.values as Booking, canonicalAccounts) }));
}

async function listBookingRowsWithSeeds() {
  const { rows, accounts } = await withLocalFallback(
    async () => ({ rows: await listRows<Booking>("bookings"), accounts: await listRows<AccountValues>("parent_accounts") }),
    () => ({ rows: localRows<Booking>("bookings"), accounts: localRows<AccountValues>("parent_accounts") })
  );
  const canonicalRows = canonicalBookingRows(rows, accounts);
  return seedCoachJordenRecurringBookings(seedTianYeRecurringBookings(canonicalRows, accounts), accounts);
}

export async function listBookings() {
  const rows = await listBookingRowsWithSeeds();
  return uniqueBookingRows(rows)
    .map(bookingFromRow)
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

async function findExistingActiveBooking(values: Partial<Booking>) {
  const tables = await ensureSchema();
  const startsAt = String(values.startsAt ?? "").trim();
  if (!startsAt) return null;

  const response = await supabase
    .from("project_rows")
    .select("id, project_table_id, values, created_at, updated_at")
    .eq("project_table_id", tables.bookings)
    .eq("values->>startsAt", startsAt)
    .limit(1000);

  if (response.error) throw setupError(response.error.message);

  const rows = (response.data ?? []) as Array<ProjectRow<Booking>>;
  return rows.find((row) => isActiveBooking(row.values) && sameBookingNaturalKey(row.values, values)) ?? null;
}

export async function createBooking(input: Omit<Booking, "id" | "status" | "createdAt" | "updatedAt">) {
  const values = {
    ...input,
    id: "",
    status: "requested" as BookingStatus,
    createdAt: "",
    updatedAt: ""
  };
  try {
    const accountRows = await listRows<AccountValues>("parent_accounts");
    const isSystemCalendarRow = values.program === "Unavailable" || values.program === "Group class";
    const linkedValues = prepareStudentReferenceForCreation(values, identityAccounts(accountRows), { requireAccount: !isSystemCalendarRow });
    const existing = await findExistingActiveBooking(linkedValues);
    if (existing) return bookingFromRow(existing);

    const row = await createRow<Booking>("bookings", linkedValues);
    return bookingFromRow(row);
  } catch (error) {
    throw error instanceof Error
      ? new Error(`Could not save to shared club view. ${error.message}`)
      : new Error("Could not save to shared club view.");
  }
}

export async function updateBooking(
  id: string,
  input: Partial<Pick<Booking, "studentAccountId" | "studentName" | "familyName" | "studentEmail" | "phone" | "status" | "assignedCoach" | "dateLabel" | "timeLabel" | "startsAt" | "parentNote">>
) {
  const [rows, accountRows] = await Promise.all([listRows<Booking>("bookings"), listRows<AccountValues>("parent_accounts")]);
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("Booking not found in shared club view");
  if (input.studentAccountId && input.studentAccountId !== row.values.studentAccountId) {
    throw new Error("Student identity cannot be changed through a class update");
  }
  const merged = { ...row.values, ...input, studentAccountId: row.values.studentAccountId };
  const values = canonicalizeStudentReference(merged as Booking, identityAccounts(accountRows));
  const updated = await updateRow("bookings", id, values);
  return bookingFromRow(updated);
}

export async function cancelBookingAsParent(id: string, studentAccountId: string, now = Date.now()) {
  const rows = await listRows<Booking>("bookings");
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("Booking not found in shared club view");
  if (!studentReferenceBelongsToAccount(row.values, studentAccountId)) {
    throw new Error("This class does not belong to the signed-in student.");
  }

  assertParentCancellationAllowed({ startsAt: String(row.values.startsAt ?? "") }, now);
  if (row.values.status !== "requested" && row.values.status !== "club_confirmed") {
    throw new Error("This class can no longer be cancelled online.");
  }

  const updated = await updateRow("bookings", id, { ...row.values, status: "cancelled" as BookingStatus });
  return bookingFromRow(updated);
}

export async function listBillNotifications() {
  const { rows, accounts } = await withLocalFallback(
    async () => ({ rows: await listRows<BillNotification>("bill_notifications"), accounts: await listRows<AccountValues>("parent_accounts") }),
    () => ({ rows: localRows<BillNotification>("bill_notifications"), accounts: localRows<AccountValues>("parent_accounts") })
  );
  const canonicalAccounts = identityAccounts(accounts);
  return rows
    .map((row) => {
      const values = canonicalizeStudentReference(row.values as BillNotification, canonicalAccounts);
      return {
        ...row,
        values: {
          ...values,
          message: values.studentAccountId ? `${values.studentName}: ${Number(values.classCount ?? 0)} completed classes ready to bill` : values.message
        }
      };
    })
    .map(billFromRow)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function createBillNotification(input: Omit<BillNotification, "id" | "createdAt">) {
  const accountRows = await withLocalFallback(
    () => listRows<AccountValues>("parent_accounts"),
    () => localRows<AccountValues>("parent_accounts")
  );
  const linkedInput = prepareStudentReferenceForCreation(input, identityAccounts(accountRows), { requireAccount: true });
  const row = await withLocalFallback(
    () => createRow("bill_notifications", linkedInput),
    () => createLocalRow("bill_notifications", linkedInput)
  );
  return billFromRow(row);
}

export async function listActivityLogs() {
  const rows = await withLocalFallback(
    () => listRows<ActivityLog>("activity_logs"),
    () => localRows<ActivityLog>("activity_logs")
  );
  return rows.map(activityLogFromRow).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function createActivityLog(input: Omit<ActivityLog, "id" | "createdAt">) {
  const row = await withLocalFallback(
    () => createRow("activity_logs", input),
    () => createLocalRow("activity_logs", input)
  );
  return activityLogFromRow(row);
}
