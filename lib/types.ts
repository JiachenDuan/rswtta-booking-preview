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
  studentName: string;
  parentName: string;
  email: string;
  phone: string;
  confirmed: boolean;
  profileSetupRequired: boolean;
  createdAt: string;
};
