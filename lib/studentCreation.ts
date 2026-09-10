export type CreatedStudentAccount = {
  id: string;
  studentName: string;
  email?: string;
  phone?: string;
};

export function reusableStudentAccountByEmail<T extends CreatedStudentAccount>(accounts: T[], email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return undefined;
  const matches = accounts.filter((account) => String(account.email ?? "").trim().toLowerCase() === normalizedEmail);
  if (matches.length > 1) throw new Error("More than one student account uses this email. Select an account explicitly.");
  return matches[0];
}

export async function createStudentAccountThenPersist<TInput, TAccount extends CreatedStudentAccount, TResult>(input: {
  student: TInput;
  createOrReuseAccount: (student: TInput) => Promise<TAccount>;
  persist: (account: TAccount) => Promise<TResult>;
}) {
  const account = await input.createOrReuseAccount(input.student);
  if (!account?.id) throw new Error("Student account creation failed. No class was created.");
  const result = await input.persist(account);
  return { account, result };
}
