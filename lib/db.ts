import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type BookingStatus = "requested" | "club_confirmed" | "change_requested" | "cancelled" | "coach_confirmed";

export type Booking = {
  id: string;
  studentName: string;
  familyName: string;
  studentEmail: string;
  phone: string;
  requestedCoach: string;
  assignedCoach: string;
  program: string;
  dateLabel: string;
  timeLabel: string;
  startsAt: string;
  priceCents: number;
  status: BookingStatus;
  parentNote: string;
  createdAt: string;
  updatedAt: string;
};

export type BillNotification = {
  id: string;
  studentName: string;
  familyName: string;
  classCount: number;
  amountCents: number;
  message: string;
  createdAt: string;
};

export type ParentAccount = {
  id: string;
  studentName: string;
  email: string;
  phone: string;
  confirmed: boolean;
  createdAt: string;
};

type DbBooking = {
  id: string;
  student_name: string;
  family_name: string;
  student_email: string | null;
  phone: string;
  requested_coach: string | null;
  assigned_coach: string | null;
  coach: string | null;
  program: string;
  date_label: string;
  time_label: string;
  starts_at: string | null;
  price_cents: number;
  status: string;
  parent_note: string | null;
  created_at: string;
  updated_at: string | null;
};

type DbBill = {
  id: string;
  student_name: string;
  family_name: string;
  class_count: number;
  amount_cents: number;
  message: string;
  created_at: string;
};

type DbParentAccount = {
  id: string;
  student_name: string;
  email: string;
  phone: string;
  password_hash: string;
  password_salt: string;
  confirmation_code: string;
  confirmed_at: string | null;
  created_at: string;
};

const dbPath = join(process.cwd(), "data", "club.db");
let db: DatabaseSync | undefined;

function nowIso() {
  return new Date().toISOString();
}

function defaultStart(hoursAhead: number) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

function normalizeStatus(status: string): BookingStatus {
  if (status === "pending") return "requested";
  if (status === "confirmed") return "club_confirmed";
  if (status === "completed") return "coach_confirmed";
  if (status === "declined") return "cancelled";
  if (["requested", "club_confirmed", "change_requested", "cancelled", "coach_confirmed"].includes(status)) {
    return status as BookingStatus;
  }
  return "requested";
}

function rowToBooking(row: DbBooking): Booking {
  const assignedCoach = row.assigned_coach ?? row.coach ?? row.requested_coach ?? "Coach A";

  return {
    id: row.id,
    studentName: row.student_name,
    familyName: row.family_name,
    studentEmail: row.student_email ?? "",
    phone: row.phone,
    requestedCoach: row.requested_coach ?? assignedCoach,
    assignedCoach,
    program: row.program,
    dateLabel: row.date_label,
    timeLabel: row.time_label,
    startsAt: row.starts_at ?? defaultStart(24),
    priceCents: row.price_cents,
    status: normalizeStatus(row.status),
    parentNote: row.parent_note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  };
}

function rowToBill(row: DbBill): BillNotification {
  return {
    id: row.id,
    studentName: row.student_name,
    familyName: row.family_name,
    classCount: row.class_count,
    amountCents: row.amount_cents,
    message: row.message,
    createdAt: row.created_at
  };
}

function rowToParentAccount(row: DbParentAccount): ParentAccount {
  return {
    id: row.id,
    studentName: row.student_name,
    email: row.email,
    phone: row.phone,
    confirmed: Boolean(row.confirmed_at),
    createdAt: row.created_at
  };
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password: string, salt: string, storedHash: string) {
  const { hash } = hashPassword(password, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getDb() {
  if (db) return db;

  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      family_name TEXT NOT NULL,
      student_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,
      requested_coach TEXT NOT NULL,
      assigned_coach TEXT NOT NULL,
      coach TEXT,
      program TEXT NOT NULL,
      date_label TEXT NOT NULL,
      time_label TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      parent_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_notifications (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      family_name TEXT NOT NULL,
      class_count INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parent_accounts (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      confirmation_code TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  rebuildLegacyBookingsTable();
  migrateBookings();
  seedBookingsIfEmpty();

  return db;
}

export function createParentAccount(input: { studentName: string; email: string; phone: string; password: string }) {
  const existing = getDb()
    .prepare("SELECT * FROM parent_accounts WHERE lower(email) = lower(?)")
    .get(input.email) as DbParentAccount | undefined;

  if (existing) {
    return { account: rowToParentAccount(existing), confirmationCode: existing.confirmation_code, alreadyExists: true };
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));
  const password = hashPassword(input.password);

  getDb()
    .prepare(
      `INSERT INTO parent_accounts (
        id, student_name, email, phone, password_hash, password_salt,
        confirmation_code, confirmed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.studentName,
      input.email.toLowerCase(),
      input.phone,
      password.hash,
      password.salt,
      confirmationCode,
      null,
      createdAt
    );

  return {
    account: {
      id,
      studentName: input.studentName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      confirmed: false,
      createdAt
    },
    confirmationCode,
    alreadyExists: false
  };
}

export function confirmParentAccount(email: string, confirmationCode: string) {
  const row = getDb()
    .prepare("SELECT * FROM parent_accounts WHERE lower(email) = lower(?)")
    .get(email) as DbParentAccount | undefined;

  if (!row || row.confirmation_code !== confirmationCode) return null;

  getDb()
    .prepare("UPDATE parent_accounts SET confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?")
    .run(nowIso(), row.id);

  const updated = getDb().prepare("SELECT * FROM parent_accounts WHERE id = ?").get(row.id) as DbParentAccount;
  return rowToParentAccount(updated);
}

export function loginParentAccount(identifier: string, password: string) {
  const row = getDb()
    .prepare("SELECT * FROM parent_accounts WHERE lower(email) = lower(?) OR phone = ?")
    .get(identifier, identifier) as DbParentAccount | undefined;

  if (!row || !row.confirmed_at || !verifyPassword(password, row.password_salt, row.password_hash)) return null;
  return rowToParentAccount(row);
}

export function listBookings() {
  const rows = getDb()
    .prepare("SELECT * FROM bookings ORDER BY datetime(starts_at) ASC, datetime(created_at) DESC")
    .all() as DbBooking[];

  return rows.map(rowToBooking);
}

export function createBooking(input: Omit<Booking, "id" | "status" | "createdAt" | "updatedAt">) {
  const timestamp = nowIso();
  const booking: Booking = {
    ...input,
    id: crypto.randomUUID(),
    status: "requested",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO bookings (
        id, student_name, family_name, student_email, phone, requested_coach,
        assigned_coach, coach, program, date_label, time_label, starts_at,
        price_cents, status, parent_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      booking.id,
      booking.studentName,
      booking.familyName,
      booking.studentEmail,
      booking.phone,
      booking.requestedCoach,
      booking.assignedCoach,
      booking.assignedCoach,
      booking.program,
      booking.dateLabel,
      booking.timeLabel,
      booking.startsAt,
      booking.priceCents,
      booking.status,
      booking.parentNote,
      booking.createdAt,
      booking.updatedAt
    );

  return booking;
}

export function updateBooking(id: string, input: Partial<Pick<Booking, "status" | "assignedCoach" | "dateLabel" | "timeLabel" | "startsAt" | "parentNote">>) {
  const existing = getDb().prepare("SELECT * FROM bookings WHERE id = ?").get(id) as DbBooking | undefined;
  if (!existing) return null;

  const current = rowToBooking(existing);
  const next = {
    status: input.status ?? current.status,
    assignedCoach: input.assignedCoach ?? current.assignedCoach,
    dateLabel: input.dateLabel ?? current.dateLabel,
    timeLabel: input.timeLabel ?? current.timeLabel,
    startsAt: input.startsAt ?? current.startsAt,
    parentNote: input.parentNote ?? current.parentNote,
    updatedAt: nowIso()
  };

  getDb()
    .prepare(
      `UPDATE bookings
       SET status = ?, assigned_coach = ?, coach = ?, date_label = ?, time_label = ?,
           starts_at = ?, parent_note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.status,
      next.assignedCoach,
      next.assignedCoach,
      next.dateLabel,
      next.timeLabel,
      next.startsAt,
      next.parentNote,
      next.updatedAt,
      id
    );

  const row = getDb().prepare("SELECT * FROM bookings WHERE id = ?").get(id) as DbBooking | undefined;
  return row ? rowToBooking(row) : null;
}

export function listBillNotifications() {
  const rows = getDb()
    .prepare("SELECT * FROM bill_notifications ORDER BY datetime(created_at) DESC LIMIT 12")
    .all() as DbBill[];

  return rows.map(rowToBill);
}

export function generateWeeklyBills() {
  const rows = getDb()
    .prepare(
      `SELECT student_name, family_name, COUNT(*) AS class_count, SUM(price_cents) AS amount_cents
       FROM bookings
       WHERE status = 'coach_confirmed'
       GROUP BY student_name, family_name
       ORDER BY family_name`
    )
    .all() as Array<{ student_name: string; family_name: string; class_count: number; amount_cents: number }>;

  const timestamp = nowIso();
  const insert = getDb().prepare(
    `INSERT INTO bill_notifications (
      id, student_name, family_name, class_count, amount_cents, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const created = rows.map((row) => {
    const amount = row.amount_cents ?? 0;
    const bill: BillNotification = {
      id: crypto.randomUUID(),
      studentName: row.student_name,
      familyName: row.family_name,
      classCount: row.class_count,
      amountCents: amount,
      message: `${row.student_name}: ${row.class_count} completed class${row.class_count === 1 ? "" : "es"} ready to bill`,
      createdAt: timestamp
    };

    insert.run(bill.id, bill.studentName, bill.familyName, bill.classCount, bill.amountCents, bill.message, bill.createdAt);
    return bill;
  });

  return created;
}

function createBookingsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      family_name TEXT NOT NULL,
      student_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,
      requested_coach TEXT NOT NULL,
      assigned_coach TEXT NOT NULL,
      coach TEXT,
      program TEXT NOT NULL,
      date_label TEXT NOT NULL,
      time_label TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      parent_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function rebuildLegacyBookingsTable() {
  const table = getDb()
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'")
    .get() as { sql: string } | undefined;

  if (!table?.sql.includes("CHECK (status IN ('pending', 'confirmed', 'declined', 'completed'))")) {
    return;
  }

  const rows = getDb().prepare("SELECT * FROM bookings").all() as Array<Record<string, unknown>>;
  getDb().exec("ALTER TABLE bookings RENAME TO bookings_legacy");
  createBookingsTable();

  const insert = getDb().prepare(
    `INSERT INTO bookings (
      id, student_name, family_name, student_email, phone, requested_coach,
      assigned_coach, coach, program, date_label, time_label, starts_at,
      price_cents, status, parent_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const row of rows) {
    const coach = String(row.assigned_coach ?? row.coach ?? row.requested_coach ?? "Coach A");
    const createdAt = String(row.created_at ?? nowIso());
    insert.run(
      String(row.id ?? crypto.randomUUID()),
      String(row.student_name ?? "Student"),
      String(row.family_name ?? "Family"),
      String(row.student_email ?? ""),
      String(row.phone ?? ""),
      String(row.requested_coach ?? coach),
      coach,
      coach,
      String(row.program ?? "Private lesson"),
      String(row.date_label ?? "Today"),
      String(row.time_label ?? "4:30 PM"),
      String(row.starts_at ?? defaultStart(24)),
      Number(row.price_cents ?? 0),
      normalizeStatus(String(row.status ?? "requested")),
      String(row.parent_note ?? ""),
      createdAt,
      String(row.updated_at ?? createdAt)
    );
  }

  getDb().exec("DROP TABLE bookings_legacy");
}

function migrateBookings() {
  const columns = new Set(
    (getDb().prepare("PRAGMA table_info(bookings)").all() as Array<{ name: string }>).map((column) => column.name)
  );

  const addColumn = (name: string, definition: string) => {
    if (!columns.has(name)) {
      getDb().exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);
      columns.add(name);
    }
  };

  addColumn("student_email", "TEXT DEFAULT ''");
  addColumn("requested_coach", "TEXT");
  addColumn("assigned_coach", "TEXT");
  addColumn("coach", "TEXT");
  addColumn("starts_at", "TEXT");
  addColumn("parent_note", "TEXT DEFAULT ''");
  addColumn("updated_at", "TEXT");

  getDb().exec(`
    UPDATE bookings SET requested_coach = COALESCE(requested_coach, coach, 'Coach A');
    UPDATE bookings SET assigned_coach = COALESCE(assigned_coach, coach, requested_coach, 'Coach A');
    UPDATE bookings SET coach = COALESCE(coach, assigned_coach, requested_coach, 'Coach A');
    UPDATE bookings SET starts_at = COALESCE(starts_at, datetime('now', '+1 day'));
    UPDATE bookings SET updated_at = COALESCE(updated_at, created_at, datetime('now'));
    UPDATE bookings SET status = 'requested' WHERE status = 'pending';
    UPDATE bookings SET status = 'club_confirmed' WHERE status = 'confirmed';
    UPDATE bookings SET status = 'coach_confirmed' WHERE status = 'completed';
    UPDATE bookings SET status = 'cancelled' WHERE status = 'declined';
  `);
}

function seedBookingsIfEmpty() {
  const count = getDb().prepare("SELECT COUNT(*) AS count FROM bookings").get() as { count: number };
  if (count.count > 0) return;

  const timestamp = nowIso();
  const seeds: Array<Omit<Booking, "id" | "createdAt" | "updatedAt">> = [
    {
      studentName: "Ethan Chen",
      familyName: "Chen Family",
      studentEmail: "ethan.parent@example.com",
      phone: "(650) 555-0188",
      requestedCoach: "Coach A",
      assignedCoach: "Coach A",
      program: "Private lesson",
      dateLabel: "Today",
      timeLabel: "4:30 PM",
      startsAt: defaultStart(26),
      priceCents: 15000,
      status: "club_confirmed",
      parentNote: ""
    },
    {
      studentName: "Mia Zhang",
      familyName: "Zhang Family",
      studentEmail: "mia.parent@example.com",
      phone: "(650) 555-0192",
      requestedCoach: "Coach B",
      assignedCoach: "Coach B",
      program: "Group lesson",
      dateLabel: "Tomorrow",
      timeLabel: "5:15 PM",
      startsAt: defaultStart(34),
      priceCents: 7500,
      status: "requested",
      parentNote: "Can do Coach A if Coach B is busy."
    },
    {
      studentName: "Ryan Wu",
      familyName: "Wu Family",
      studentEmail: "ryan.parent@example.com",
      phone: "(650) 555-0115",
      requestedCoach: "Coach A",
      assignedCoach: "Coach A",
      program: "Private lesson",
      dateLabel: "Yesterday",
      timeLabel: "6:00 PM",
      startsAt: defaultStart(-20),
      priceCents: 10000,
      status: "coach_confirmed",
      parentNote: ""
    }
  ];

  const insert = getDb().prepare(
    `INSERT INTO bookings (
      id, student_name, family_name, student_email, phone, requested_coach,
      assigned_coach, coach, program, date_label, time_label, starts_at,
      price_cents, status, parent_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const seed of seeds) {
    const id = crypto.randomUUID();
    insert.run(
      id,
      seed.studentName,
      seed.familyName,
      seed.studentEmail,
      seed.phone,
      seed.requestedCoach,
      seed.assignedCoach,
      seed.assignedCoach,
      seed.program,
      seed.dateLabel,
      seed.timeLabel,
      seed.startsAt,
      seed.priceCents,
      seed.status,
      seed.parentNote,
      timestamp,
      timestamp
    );
  }
}
