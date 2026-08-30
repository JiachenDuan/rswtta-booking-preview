import {
  CalendarCheck,
  Clock3,
  CreditCard,
  ShieldCheck,
  TrendingUp,
  UsersRound
} from "lucide-react";

export const stats = [
  { label: "Today classes", value: "18", detail: "6 need coach confirmation", icon: CalendarCheck },
  { label: "Active students", value: "126", detail: "Youth, adult, and team players", icon: UsersRound },
  { label: "Monthly revenue", value: "$24.8k", detail: "Memberships, courses, league", icon: TrendingUp },
  { label: "Open balances", value: "$3.9k", detail: "21 family accounts", icon: CreditCard }
];

export const coaches = [
  {
    name: "Coach Tian Ye",
    focus: "Head coach, elite player development",
    rating: "4.9",
    next: "Today 4:30 PM",
    price: "$150 single / $1,300 pack",
    color: "mint",
    image:
      "https://images.unsplash.com/photo-1599474924187-334a4ae5bd3c?auto=format&fit=crop&w=900&q=80"
  },
  {
    name: "National Level Coach",
    focus: "Private 1-on-1 coaching",
    rating: "4.8",
    next: "Mon 5:00 PM",
    price: "$100 single / $900 pack",
    color: "coral",
    image:
      "https://images.unsplash.com/photo-1578269174936-2709b6aeb913?auto=format&fit=crop&w=900&q=80"
  },
  {
    name: "Group Lesson",
    focus: "Skills, rallies, and class training",
    rating: "5.0",
    next: "Tue 6:15 PM",
    price: "$75 drop-in / $600 pack",
    color: "blue",
    image:
      "https://images.unsplash.com/photo-1534158914592-062992fbe900?auto=format&fit=crop&w=900&q=80"
  }
];

export const appointments = [
  {
    student: "Ethan Chen",
    coach: "Coach Tian Ye",
    date: "Today",
    time: "4:30 PM",
    type: "Private 1:1",
    status: "Confirmed"
  },
  {
    student: "Mia Zhang",
    coach: "National Level Coach",
    date: "Today",
    time: "5:15 PM",
    type: "Semi-private",
    status: "Waiting"
  },
  {
    student: "Ryan Wu",
    coach: "Group Lesson",
    date: "Tomorrow",
    time: "6:00 PM",
    type: "Competition team",
    status: "Confirmed"
  },
  {
    student: "Sofia Park",
    coach: "Coach Tian Ye",
    date: "Fri",
    time: "4:00 PM",
    type: "Group class",
    status: "Needs payment"
  }
];

export const bills = [
  { family: "Chen Family", classes: 7, balance: "$560", due: "Sep 1", state: "Open" },
  { family: "Zhang Family", classes: 4, balance: "$280", due: "Sep 3", state: "Open" },
  { family: "Wu Family", classes: 10, balance: "$0", due: "Paid", state: "Paid" },
  { family: "Park Family", classes: 2, balance: "$120", due: "Aug 31", state: "Reminder" }
];

export const timeline = [
  { label: "Parent logs in", detail: "Phone number receives a text code", icon: Clock3 },
  { label: "Request sent", detail: "Parent chooses coach, date, and class time", icon: Clock3 },
  { label: "Coach confirms", detail: "Coach receives a confirmation task", icon: ShieldCheck },
  { label: "Class completed", detail: "Attendance adds to family bill", icon: CalendarCheck },
  { label: "Bill collected", detail: "Club tracks balances and payments", icon: CreditCard }
];

export const clubFacts = [
  "SF Bay Area academy",
  "Led by Coach Tian Ye",
  "Training home for US National Team players",
  "Private coaching, group courses, camps, and Saturday league"
];

export const pricing = [
  {
    name: "Group Lesson",
    member: "$600 / 10 pack",
    nonMember: "$700 / 10 pack",
    dropIn: "$75"
  },
  {
    name: "National Level Coach",
    member: "$900 / 10 pack",
    nonMember: "$950 / 10 pack",
    dropIn: "$100"
  },
  {
    name: "Head Coach Tian",
    member: "$1,300 / 10 pack",
    nonMember: "Package pricing",
    dropIn: "$150"
  }
];

export const memberships = [
  {
    name: "Basic Membership",
    price: "$700",
    cadence: "Adult / year",
    perks: ["Junior $550 / year", "Family $1,350 / year", "24/7 open play", "Training machine access"]
  },
  {
    name: "Pro Membership",
    price: "$2,800",
    cadence: "per year",
    perks: ["52 group lessons per year", "24/7 open play", "Training machine access", "Premium gear bundle"]
  },
  {
    name: "Saturday League",
    price: "$12 / $15",
    cadence: "member / non-member",
    perks: ["Warm-up 4:30 PM", "Matches 5:30 PM", "USATT membership required", "Weekly competition"]
  }
];
