"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ShieldAlert, UserPlus, X } from "lucide-react";
import { createClubPreregistration, previewClubPreregistration, previewPreregistrationCollisions, validatePreregistrationInput, type PreregistrationInput } from "@/lib/clubPreregistration";
import type { ParentAccount } from "@/lib/types";

type Language = "en" | "zh";
const copy = (language: Language, en: string, zh: string) => language === "zh" ? zh : en;
const emptyInput = (): PreregistrationInput => ({ studentName: "", email: "", phone: "" });

export function RegisterStudentPanel({ students, language, clubIdentifier, legacyClubProof, onCreated }: { students: ParentAccount[]; language: Language; clubIdentifier: string; legacyClubProof: string; onCreated: () => Promise<void> }) {
  const [input, setInput] = useState(emptyInput);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const collisions = useMemo(() => { try { return previewPreregistrationCollisions(students, input); } catch { return []; } }, [students, input]);
  const blockingEmailCollision = collisions.some((item) => item.kinds.includes("email"));

  function review() {
    try {
      validatePreregistrationInput(input);
      if (!legacyClubProof) throw new Error(copy(language, "Log out and sign in again before registering a student.", "注册学生前请退出并重新登录。"));
      if (blockingEmailCollision) throw new Error(copy(language, "That email already belongs to an account. Select the existing account instead.", "该邮箱已属于现有账号。请改用现有账号。"));
      setNotice(""); setStep("confirm");
    } catch (error) { setNotice(error instanceof Error ? error.message : copy(language, "Check the entered details.", "请检查所填信息。")); }
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setNotice(copy(language, "Checking the duplicate snapshot…", "正在检查重复项快照…"));
    try {
      const preview = await previewClubPreregistration(input, clubIdentifier, legacyClubProof);
      const result = await createClubPreregistration(input, preview.snapshotHash, requestKey.current, clubIdentifier, legacyClubProof);
      setNotice(copy(language, `Pending account created. Login alias: ${result.loginAlias}. The temporary password must be changed at first login.`, `待完善账号已创建。登录别名：${result.loginAlias}。首次登录必须修改临时密码。`));
      setInput(emptyInput()); setStep("form"); requestKey.current = crypto.randomUUID(); await onCreated();
    } catch (error) { setNotice(error instanceof Error ? error.message : copy(language, "No account was created.", "未创建账号。")); }
    finally { setBusy(false); }
  }

  return <section className="section-block preregister-panel" data-club-only="true">
    <div className="section-head"><div><p className="eyebrow">{copy(language, "Register new student", "注册新学生")}</p><h2>{copy(language, "Create one setup-only account", "创建一个仅可设置的账号")}</h2><p className="section-subtitle">{copy(language, "Student name is required. Contact fields are optional. The account remains unconfirmed and cannot open Parent areas until a different password is set.", "学生姓名为必填项，联系方式可选。账号保持未确认状态，设置不同密码前无法进入家长功能。")}</p></div><span className="status-chip"><ShieldAlert size={15}/>{copy(language, "Legacy Club gate", "旧版俱乐部门控")}</span></div>
    {step === "form" ? <><div className="modal-field-grid preregister-fields">
      <label><span>{copy(language, "Student name", "学生姓名")} *</span><input aria-label={copy(language, "Student name", "学生姓名")} value={input.studentName} maxLength={120} onChange={(event) => setInput({ ...input, studentName: event.target.value })}/></label>
      <label><span>{copy(language, "Email (optional)", "邮箱（可选）")}</span><input aria-label={copy(language, "Email", "邮箱")} type="email" value={input.email} maxLength={320} onChange={(event) => setInput({ ...input, email: event.target.value })}/></label>
      <label><span>{copy(language, "Phone (optional)", "电话（可选）")}</span><input aria-label={copy(language, "Phone", "电话")} inputMode="tel" value={input.phone} maxLength={30} onChange={(event) => setInput({ ...input, phone: event.target.value })}/></label>
    </div>
    {collisions.length ? <div className="action-confirm-panel duplicate-student-panel" aria-live="polite"><strong>{copy(language, "Possible matches", "可能匹配的账号")}</strong><p>{copy(language, "Matching display names stay separate UUID accounts. The server will issue a visible unique login alias when a name is ambiguous. Matching email is blocked; shared phones are only shown.", "相同显示姓名仍为独立 UUID 账号。姓名有歧义时服务器会生成可见的唯一登录别名。相同邮箱会被阻止；共享电话仅作提示。")}</p><div className="student-results modal-results">{collisions.map((item) => <div className="student-result selected locked-selection" key={item.accountId}><span><strong>{item.studentName}</strong><em>{item.kinds.join(" · ")} · {copy(language, "Account", "账号")} {item.accountId.slice(0, 8)}</em></span></div>)}</div></div> : null}
    <button className="primary-button" type="button" onClick={review}><UserPlus size={18}/>{copy(language, "Review preregistration", "检查预注册信息")}</button></> : <div className="action-confirm-panel preregister-confirm" role="alertdialog" aria-labelledby="preregister-confirm-title"><strong id="preregister-confirm-title">{copy(language, "Second confirmation", "二次确认")}</strong><p>{copy(language, `Create exactly one pending, unconfirmed account for ${validatePreregistrationInput(input).studentName}?`, `确定只为 ${validatePreregistrationInput(input).studentName} 创建一个待完善、未确认账号吗？`)}</p><ul><li>{copy(language, "Exactly one redacted activity; no class, booking, bill, group, or package event.", "只创建一条已隐去敏感信息的活动记录；不会创建课程、预约、账单、团体或课包事件。")}</li><li>{copy(language, "First login is setup-only and must replace the temporary password.", "首次登录仅可设置，并且必须更换临时密码。")}</li></ul><div className="modal-actions"><button className="ghost-button" disabled={busy} onClick={() => setStep("form")}><X size={18}/>{copy(language, "Back", "返回")}</button><button className="primary-button" disabled={busy || blockingEmailCollision || !legacyClubProof} onClick={() => void submit()}><Check size={18}/>{busy ? copy(language, "Checking…", "正在检查…") : copy(language, "Confirm pending account", "确认创建待完善账号")}</button></div></div>}
    {notice ? <p className="system-note" role="status">{notice}</p> : null}
  </section>;
}
