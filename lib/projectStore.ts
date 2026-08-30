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
    ["confirmed", "boolean"]
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

type AccountValues = ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string };
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
  await Promise.all(
    definitions.map(([slug, dataType], index) =>
      supabase
        .from("project_columns")
        .upsert(
          {
            project_table_id: table.id,
            slug,
            name: slug,
            data_type: dataType,
            sort_order: index
          },
          { onConflict: "project_table_id,slug" }
        )
        .then(({ error }) => {
          if (error) throw setupError(error.message);
        })
    )
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

function accountFromRow(row: ProjectRow<ParentAccount & { passwordHash: string; passwordSalt: string; confirmationCode: string }>): ParentAccount {
  return {
    id: row.id,
    studentName: String(row.values.studentName ?? "Student"),
    email: String(row.values.email ?? ""),
    phone: String(row.values.phone ?? ""),
    confirmed: Boolean(row.values.confirmed),
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
    requestedCoach: String(row.values.requestedCoach ?? row.values.assignedCoach ?? "Coach A"),
    assignedCoach: String(row.values.assignedCoach ?? row.values.requestedCoach ?? "Coach A"),
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
    .eq("project_table_id", tables[tableSlug]);
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
      if (authResult.error && !authResult.error.message.toLowerCase().includes("already")) throw authResult.error;

      const rows = await listRows<AccountValues>("parent_accounts");
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
        confirmed: true
      });
      return { account: accountFromRow(row), alreadyExists: false };
    },
    async () => {
      const email = input.email.toLowerCase();
      const rows = localRows<AccountValues>("parent_accounts");
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
        confirmed: true
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
      if (isEmail) {
        const authResult = await supabase.auth.signInWithPassword({
          email: normalizedIdentifier,
          password
        });
        if (authResult.error) throw authResult.error;
      }

      const rows = await listRows<AccountValues>("parent_accounts");
      const row = rows.find(
        (item) =>
          String(item.values.email ?? "").toLowerCase() === normalizedIdentifier || String(item.values.phone ?? "") === identifier
      );
      if (!row) throw new Error("Invalid login");
      if (!isEmail) {
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
      const rows = localRows<AccountValues>("parent_accounts");
      const row = rows.find(
        (item) =>
          String(item.values.email ?? "").toLowerCase() === identifier.toLowerCase() || String(item.values.phone ?? "") === identifier
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

export async function resetPasswordForEmail(email: string) {
  const redirectTo = isBrowser() ? window.location.origin : undefined;
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
        confirmed: true
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
      confirmed: true
    });
  }
}

export async function listBookings() {
  const rows = await withLocalFallback(() => listRows<Booking>("bookings"), () => localRows<Booking>("bookings"));
  return rows
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
  const row = await withLocalFallback(() => createRow<Booking>("bookings", values), () => createLocalRow("bookings", values));
  return bookingFromRow(row);
}

export async function updateBooking(
  id: string,
  input: Partial<Pick<Booking, "status" | "assignedCoach" | "dateLabel" | "timeLabel" | "startsAt" | "parentNote">>
) {
  const updated = await withLocalFallback(
    async () => {
      const rows = await listRows<Booking>("bookings");
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("Booking not found");
      return updateRow("bookings", id, { ...row.values, ...input });
    },
    () => {
      const rows = localRows<Booking>("bookings");
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("Booking not found");
      return updateLocalRow("bookings", id, { ...row.values, ...input });
    }
  );
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
