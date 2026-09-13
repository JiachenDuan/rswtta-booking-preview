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
  /** Future immutable coach identities; snapshots currently have none. */
  coachId?: string;
  assignedCoachId?: string;
  requestedCoachId?: string;
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

export type PackageCategory = "coach_director_private" | "national_coach_private" | "group_class";
export type PackageUnitBasis = "hours" | "class_credit";

export type PackageBalance = {
  packageId: string | null;
  studentAccountId: string;
  category: PackageCategory;
  unitBasis: PackageUnitBasis;
  openingAmountBaseUnits: number;
  adjustmentAmountBaseUnits: number;
  usageAmountBaseUnits: number;
  remainingAmountBaseUnits: number;
  version: number;
  lastEventAt: string | null;
};

export type PackageLedgerEvent = {
  eventId: string;
  packageId: string;
  studentAccountId: string;
  category: PackageCategory;
  unitBasis: PackageUnitBasis;
  eventType: "opening_set" | "adjustment" | "usage";
  amountBaseUnits: number;
  oldOpeningAmountBaseUnits: number | null;
  newOpeningAmountBaseUnits: number | null;
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
  unitBasis: PackageUnitBasis;
  oldOpeningAmountBaseUnits: number;
  newOpeningAmountBaseUnits: number;
  oldRemainingAmountBaseUnits: number;
  newRemainingAmountBaseUnits: number;
  oldVersion: number;
  newVersion: number;
  createdAt: string;
  replayed: boolean;
};
