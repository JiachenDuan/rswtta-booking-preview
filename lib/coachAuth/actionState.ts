export type CoachActionState = { status: "idle" | "success" | "error"; message: string };
export const initialCoachActionState: CoachActionState = { status: "idle", message: "" };
