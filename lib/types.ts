export type BookingStatus = "requested" | "club_confirmed" | "change_requested" | "cancelled" | "coach_confirmed";

export type Booking = {
  id: string;
  studentAccountId?: string;
  /** Immutable identity of the weekly series, when this is a recurring class. */
  seriesId?: string;
  /** Immutable identity of the original series slot, even after a move. */
  recurrenceOccurrenceId?: string;
  recurrenceOriginalStartsAt?: string;
  /** Permanent identity shared by a group block and all of its enrollments. */
  groupClassId?: string;
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
  studentAccountId?: string;
  studentName: string;
  familyName: string;
  classCount: number;
  amountCents: number;
  message: string;
  createdAt: string;
};

export type ActivityLog = {
  id: string;
  action: string;
  message: string;
  studentName: string;
  coach: string;
  dateLabel: string;
  timeLabel: string;
  count: number;
  createdAt: string;
};

export type ParentAccount = {
  id: string;
  preregisteredName?: string;
  studentName: string;
  parentName: string;
  email: string;
  phone: string;
  confirmed: boolean;
  profileSetupRequired: boolean;
  createdAt: string;
};

export type PackageCategory = "coach_director" | "national_coach" | "group_class";

export type PackageBalance = {
  packageId: string | null;
  studentAccountId: string;
  category: PackageCategory;
  openingMinutes: number;
  adjustmentMinutes: number;
  usageMinutes: number;
  remainingMinutes: number;
  version: number;
  lastEventAt: string | null;
};

export type PackageLedgerEvent = {
  eventId: string;
  packageId: string;
  studentAccountId: string;
  category: PackageCategory;
  eventType: "opening_set" | "adjustment" | "usage";
  amountMinutes: number;
  oldOpeningMinutes: number | null;
  newOpeningMinutes: number | null;
  version: number;
  note: string;
  reference: string;
  actorKind: "legacy_club_session_unverified" | "service_role";
  createdAt: string;
};

export type SetPackageOpeningResult = {
  eventId: string;
  packageId: string;
  studentAccountId: string;
  category: PackageCategory;
  oldOpeningMinutes: number;
  newOpeningMinutes: number;
  oldRemainingMinutes: number;
  newRemainingMinutes: number;
  oldVersion: number;
  newVersion: number;
  createdAt: string;
  replayed: boolean;
};
