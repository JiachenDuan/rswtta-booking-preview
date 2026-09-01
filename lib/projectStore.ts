import { supabase } from "@/lib/supabase";
import type { BillNotification, Booking, BookingStatus, ParentAccount } from "@/lib/types";

const projectSlug = "rswtta-booking";
const projectName = "Rising Stars World Table Tennis Academy";

const tableDefinitions = {
  bookings: [
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
    ["studentName", "text"],
    ["email", "text"],
    ["phone", "text"],
    ["passwordHash", "text"],
    ["passwordSalt", "text"],
    ["confirmationCode", "text"],
    ["confirmed", "boolean"],
    ["profileSetupRequired", "boolean"]
  ],
  bill_notifications: [
    ["studentName", "text"],
    ["familyName", "text"],
    ["classCount", "number"],
    ["amountCents", "number"],
    ["message", "text"]
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
};

function emptyLocalStore(): LocalRowMap {
  return {
    bookings: [],
    parent_accounts: [],
    bill_notifications: []
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

async function withLocalFallback<T>(remoteAction: () => Promise<T>, localAction: () => T | Promise<T>) {
  try {
    return await remoteAction();
  } catch {
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

function uniqueAccountRowsByStudentName(rows: Array<ProjectRow<AccountValues>>) {
  const byName = new Map<string, ProjectRow<AccountValues>>();
  for (const row of rows) {
    const key = studentNameKey(row.values.studentName);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }
    const existingHasContact = Boolean(String(existing.values.email ?? "") || String(existing.values.phone ?? ""));
    const rowHasContact = Boolean(String(row.values.email ?? "") || String(row.values.phone ?? ""));
    if (!existingHasContact && rowHasContact) byName.set(key, row);
  }
  return [...byName.values()];
}

function normalizeCoachName(value: unknown) {
  const coach = String(value ?? "Coach A");
  if (coach === "Coach A" || coach === "National A") return "National A";
  if (coach === "Coach B" || coach === "National B") return "National B";
  return coach;
}

function accountFromRow(row: ProjectRow<ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string }>): ParentAccount {
  return {
    id: row.id,
    studentName: String(row.values.studentName ?? "Student"),
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
    studentName: String(row.values.studentName ?? "Student"),
    familyName: String(row.values.familyName ?? row.values.studentName ?? "Student"),
    classCount: Number(row.values.classCount ?? 0),
    amountCents: Number(row.values.amountCents ?? 0),
    message: String(row.values.message ?? ""),
    createdAt: row.created_at
  };
}

async function listRows<T>(tableSlug: keyof typeof tableDefinitions) {
  const tables = await ensureSchema();
  const response = await supabase
    .from("project_rows")
    .select("id, project_table_id, values, created_at, updated_at")
    .eq("project_table_id", tables[tableSlug])
    .range(0, 4999);
  if (response.error) throw setupError(response.error.message);
  return response.data as Array<ProjectRow<T>>;
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
  const existingNames = new Set(rows.map((row) => String(row.values.studentName ?? "").trim().toLowerCase()).filter(Boolean));
  const password = await hashPassword(preregisteredPasswordTemplate);
  const created: Array<ProjectRow<AccountValues>> = [];

  for (const studentName of preregisteredStudentNames) {
    if (existingNames.has(studentName.toLowerCase())) continue;
    const row = await create({
      id: "",
      studentName,
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
    async () => {
      const rows = await listRows<AccountValues>("parent_accounts");
      return seedPreregisteredAccounts(rows, (values) => createRow<AccountValues>("parent_accounts", values));
    },
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

export async function loginParentAccount(identifier: string, password: string) {
  return withLocalFallback(
    async () => {
      const normalizedIdentifier = identifier.toLowerCase();
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
      const row = rows.find(
        (item) => String(item.values.studentName ?? "").trim().toLowerCase() === normalizedIdentifier
      );
      if (!row) throw authError ?? new Error("Invalid login");
      if (!isEmail || authError) {
        const ok = await verifyPassword(password, String(row.values.passwordSalt ?? ""), String(row.values.passwordHash ?? ""));
        if (!ok) throw new Error("Invalid login");
      }
      if (!row.values.confirmed) {
        const updated = await updateRow("parent_accounts", row.id, { ...row.values, confirmed: true });
        return accountFromRow(updated);
      }
      return accountFromRow(row);
    },
    async () => {
      const rows = await seedPreregisteredAccounts(localRows<AccountValues>("parent_accounts"), (values) => createLocalRow("parent_accounts", values));
      const normalizedIdentifier = identifier.toLowerCase();
      const row = rows.find(
        (item) => String(item.values.studentName ?? "").trim().toLowerCase() === normalizedIdentifier
      );
      if (!row) throw new Error("Invalid login");
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
  return uniqueAccountRowsByStudentName(rows).map(accountFromRow).sort((left, right) => left.studentName.localeCompare(right.studentName));
}

export async function resetPasswordForEmail(email: string) {
  const redirectTo = isBrowser() ? `${window.location.origin}${window.location.pathname}` : undefined;
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

export async function updateParentAccount(input: { accountId: string; studentName: string; email: string; phone: string }) {
  const normalizedStudentName = input.studentName.trim();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone.trim();
  if (!normalizedStudentName || !normalizedEmail.includes("@") || normalizedPhone.length < 7) {
    throw new Error("Student name, email, and phone are required");
  }

  const values = {
    studentName: normalizedStudentName,
    email: normalizedEmail,
    phone: normalizedPhone
  };

  const row = await withLocalFallback(
    async () => {
      const rows = await listRows<AccountValues>("parent_accounts");
      const existing = rows.find((item) => item.id === input.accountId);
      if (!existing) throw new Error("Account not found");
      const duplicate = rows.find(
        (item) =>
          item.id !== input.accountId &&
          normalizedEmail &&
          String(item.values.email ?? "").toLowerCase() === normalizedEmail
      );
      if (duplicate) throw new Error("Email already used by another student");
      const duplicateName = rows.find((item) => item.id !== input.accountId && studentNameKey(item.values.studentName) === studentNameKey(normalizedStudentName));
      if (duplicateName) throw new Error("Student name already has an account");
      return updateRow("parent_accounts", input.accountId, { ...existing.values, ...values });
    },
    () => {
      const rows = localRows<AccountValues>("parent_accounts");
      const existing = rows.find((item) => item.id === input.accountId);
      if (!existing) throw new Error("Account not found");
      const duplicate = rows.find(
        (item) =>
          item.id !== input.accountId &&
          normalizedEmail &&
          String(item.values.email ?? "").toLowerCase() === normalizedEmail
      );
      if (duplicate) throw new Error("Email already used by another student");
      const duplicateName = rows.find((item) => item.id !== input.accountId && studentNameKey(item.values.studentName) === studentNameKey(normalizedStudentName));
      if (duplicateName) throw new Error("Student name already has an account");
      return updateLocalRow("parent_accounts", input.accountId, { ...existing.values, ...values });
    }
  );

  return accountFromRow(row);
}

export async function completeParentProfileSetup(input: { accountId: string; email: string; phone: string; password: string }) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone.trim();
  if (!normalizedEmail.includes("@") || normalizedPhone.length < 7 || input.password.length < 6 || input.password === preregisteredPasswordTemplate) {
    throw new Error("Email, phone, and a new password are required");
  }

  const passwordParts = await hashPassword(input.password);
  const values = {
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash: passwordParts.hash,
    passwordSalt: passwordParts.salt,
    confirmed: true,
    profileSetupRequired: false
  };

  const row = await withLocalFallback(
    async () => {
      const rows = await listRows<AccountValues>("parent_accounts");
      const existing = rows.find((item) => item.id === input.accountId);
      if (!existing) throw new Error("Account not found");
      const duplicate = rows.find(
        (item) =>
          item.id !== input.accountId &&
          normalizedEmail &&
          String(item.values.email ?? "").toLowerCase() === normalizedEmail
      );
      if (duplicate) throw new Error("Email already used by another student");
      return updateRow("parent_accounts", input.accountId, { ...existing.values, ...values });
    },
    () => {
      const rows = localRows<AccountValues>("parent_accounts");
      const existing = rows.find((item) => item.id === input.accountId);
      if (!existing) throw new Error("Account not found");
      const duplicate = rows.find(
        (item) =>
          item.id !== input.accountId &&
          normalizedEmail &&
          String(item.values.email ?? "").toLowerCase() === normalizedEmail
      );
      if (duplicate) throw new Error("Email already used by another student");
      return updateLocalRow("parent_accounts", input.accountId, { ...existing.values, ...values });
    }
  );

  return accountFromRow(row);
}


type RecurringClassSeed = {
  studentName: string;
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

function tianRecurringKey(values: Partial<Booking>) {
  return `${values.studentName ?? ""}|${values.assignedCoach ?? values.requestedCoach ?? ""}|${values.startsAt ?? ""}`;
}

function tianRecurringBookingValues(seed: RecurringClassSeed, date: Date): Booking {
  const starts = new Date(date);
  starts.setHours(seed.startHour, seed.startMinute, 0, 0);
  return {
    id: "",
    studentName: seed.studentName,
    familyName: seed.studentName,
    studentEmail: "",
    phone: "",
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


function coachJordenRecurringBookingValues(seed: RecurringClassSeed, date: Date): Booking {
  const starts = new Date(date);
  starts.setHours(seed.startHour, seed.startMinute, 0, 0);
  return {
    id: "",
    studentName: seed.studentName,
    familyName: seed.studentName,
    studentEmail: "",
    phone: "",
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

function coachJordenRecurringBookingsThroughDec31() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(2026, 11, 31, 23, 59, 59, 999);
  const bookings: Booking[] = [];
  for (const seed of coachJordenRecurringClassSeeds) {
    for (let date = nextDateForDay(start, seed.day); date <= end; date.setDate(date.getDate() + 7)) {
      bookings.push(coachJordenRecurringBookingValues(seed, new Date(date)));
    }
  }
  return bookings;
}

function seedCoachJordenRecurringBookings(rows: Array<ProjectRow<Booking>>) {
  return appendMissingRecurringBookings(rows, coachJordenRecurringBookingsThroughDec31());
}

function tianYeRecurringBookingsThroughDec31() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(2026, 11, 31, 23, 59, 59, 999);
  const bookings: Booking[] = [];
  for (const seed of tianYeRecurringClassSeeds) {
    for (let date = nextDateForDay(start, seed.day); date <= end; date.setDate(date.getDate() + 7)) {
      bookings.push(tianRecurringBookingValues(seed, new Date(date)));
    }
  }
  return bookings;
}

function virtualBookingRow(booking: Booking): ProjectRow<Booking> {
  return {
    id: `virtual-${booking.assignedCoach}-${booking.studentName}-${booking.startsAt}`.replace(/\s+/g, "-"),
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

function seedTianYeRecurringBookings(rows: Array<ProjectRow<Booking>>) {
  return appendMissingRecurringBookings(rows, tianYeRecurringBookingsThroughDec31());
}

function uniqueBookingRows(rows: Array<ProjectRow<Booking>>) {
  const byKey = new Map<string, ProjectRow<Booking>>();
  for (const row of rows) {
    const note = String(row.values.parentNote ?? "");
    const key = note.includes("Imported Coach Tian Ye recurring class from Excel") || note.includes("Imported Coach Wang recurring class from Excel as Coach Jorden")
      ? `recurring-import|${row.values.assignedCoach ?? row.values.requestedCoach ?? ""}|${row.values.studentName ?? ""}|${row.values.startsAt ?? ""}`
      : row.id;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function listBookingRowsWithSeeds() {
  const rows = await withLocalFallback(() => listRows<Booking>("bookings"), () => localRows<Booking>("bookings"));
  return seedCoachJordenRecurringBookings(seedTianYeRecurringBookings(rows));
}

export async function listBookings() {
  const rows = await listBookingRowsWithSeeds();
  return uniqueBookingRows(rows)
    .map(bookingFromRow)
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
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
    const row = await createRow<Booking>("bookings", values);
    return bookingFromRow(row);
  } catch (error) {
    throw error instanceof Error
      ? new Error(`Could not save to shared club view. ${error.message}`)
      : new Error("Could not save to shared club view.");
  }
}

export async function updateBooking(
  id: string,
  input: Partial<Pick<Booking, "studentName" | "familyName" | "studentEmail" | "phone" | "status" | "assignedCoach" | "dateLabel" | "timeLabel" | "startsAt" | "parentNote">>
) {
  const rows = await listRows<Booking>("bookings");
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("Booking not found in shared club view");
  const updated = await updateRow("bookings", id, { ...row.values, ...input });
  return bookingFromRow(updated);
}

export async function listBillNotifications() {
  const rows = await withLocalFallback(
    () => listRows<BillNotification>("bill_notifications"),
    () => localRows<BillNotification>("bill_notifications")
  );
  return rows.map(billFromRow).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function createBillNotification(input: Omit<BillNotification, "id" | "createdAt">) {
  const row = await withLocalFallback(
    () => createRow("bill_notifications", input),
    () => createLocalRow("bill_notifications", input)
  );
  return billFromRow(row);
}
