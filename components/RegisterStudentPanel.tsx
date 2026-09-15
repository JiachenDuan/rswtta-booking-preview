"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Search, ShieldAlert, UserCheck, UserPlus, X } from "lucide-react";
import { createClubPreregistration, creationDecision, previewClubPreregistration, previewPreregistrationCollisions, searchClubStudents, validatePreregistrationInput, type PreregistrationInput, type PreregistrationPreview, type StudentSearchResponse } from "@/lib/clubPreregistration";
import type { ParentAccount } from "@/lib/types";
import { isTrustedOperatorContextActive } from "@/lib/coachAuth/clientContext";

type Language = "en" | "zh";
const copy = (language: Language, en: string, zh: string) => language === "zh" ? zh : en;
const emptyInput = (): PreregistrationInput => ({ studentName: "", email: "", phone: "", loginAlias: "" });
const collisionLabel = (kind: string, language: Language) => ({ exact_name: copy(language, "Exact name", "姓名完全相同"), similar_name: copy(language, "Similar name", "姓名相似"), email: copy(language, "Exact email", "邮箱完全相同"), phone: copy(language, "Exact phone", "电话完全相同"), login_alias: copy(language, "Exact login alias", "登录别名完全相同") }[kind] ?? kind);
const statusLabel = (status: string, language: Language) => status === "active" ? copy(language, "Active", "已启用") : status === "setup_required" ? copy(language, "Setup required", "待完善") : copy(language, "Unconfirmed", "未确认");

export function RegisterStudentPanel({ students, language, clubIdentifier, legacyClubProof, onCreated, onChooseExisting }: { students: ParentAccount[]; language: Language; clubIdentifier: string; legacyClubProof: string; onCreated: () => Promise<void>; onChooseExisting: (account: ParentAccount) => void }) {
  const [input, setInput] = useState(emptyInput);
  const [step, setStep] = useState<"search" | "form" | "confirm">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<StudentSearchResponse | null>(null);
  const [serverPreview, setServerPreview] = useState<PreregistrationPreview | null>(null);
  const [reviewedSameName, setReviewedSameName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const collisions = useMemo(() => { try { return previewPreregistrationCollisions(students, input); } catch { return []; } }, [students, input]);
  const decision = useMemo(() => { try { return creationDecision(collisions, input, reviewedSameName); } catch { return { blocked: true, reason: "invalid" } as const; } }, [collisions, input, reviewedSameName]);
  const exactNameCollisions = (serverPreview?.collisions ?? collisions).filter((item) => item.kinds.includes("exact_name"));
  const hasVerifiedClubGate = isTrustedOperatorContextActive() || Boolean(legacyClubProof);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(copy(language, "Searching all existing student identities…", "正在搜索所有现有学生身份…"));
    try {
      if (!hasVerifiedClubGate) throw new Error(copy(language, "Log out and sign in again before searching.", "搜索前请退出并重新登录。"));
      const result = await searchClubStudents(searchQuery, clubIdentifier, legacyClubProof);
      setSearchResponse(result); setNotice(result.results.length ? copy(language, `${result.results.length} possible match(es). Choose an account or continue only if this is a different student.`, `找到 ${result.results.length} 个可能匹配。请选择账号；只有确定为不同学生时才继续。`) : copy(language, "No matches found. You may continue to Step 2.", "未找到匹配。可以继续第 2 步。"));
    } catch (error) { setSearchResponse(null); setNotice(error instanceof Error ? error.message : copy(language, "Search failed; creation stays locked.", "搜索失败；创建功能仍被锁定。")); }
    finally { setBusy(false); }
  }

  async function review() {
    if (!searchResponse) { setNotice(copy(language, "Complete Step 1 search first.", "请先完成第 1 步搜索。")); return; }
    setBusy(true);
    try {
      validatePreregistrationInput(input);
      if (!hasVerifiedClubGate) throw new Error(copy(language, "Log out and sign in again before registering a student.", "注册学生前请退出并重新登录。"));
      const localDecision = creationDecision(collisions, input, reviewedSameName);
      if (localDecision.blocked) throw new Error(blockMessage(localDecision.reason));
      const preview = await previewClubPreregistration(input, requestKey.current, clubIdentifier, legacyClubProof);
      const authoritative = creationDecision(preview.collisions, preview.normalized, reviewedSameName);
      if (authoritative.blocked) throw new Error(blockMessage(authoritative.reason));
      setServerPreview(preview); setNotice(""); setStep("confirm");
    } catch (error) { setServerPreview(null); setNotice(error instanceof Error ? error.message : copy(language, "Check the entered details.", "请检查所填信息。")); }
    finally { setBusy(false); }
  }

  function blockMessage(reason: string) {
    if (reason === "email") return copy(language, "Blocked: that email already belongs to an account. Choose the existing account.", "已阻止：该邮箱已属于现有账号。请选择现有账号。");
    if (reason === "login_alias") return copy(language, "Blocked: that login alias already belongs to an account.", "已阻止：该登录别名已属于现有账号。");
    if (reason === "name_contact") return copy(language, "Blocked: the exact name and contact match the same account.", "已阻止：完全相同的姓名和联系方式属于同一账号。");
    if (reason === "name_only") return copy(language, "Blocked: an exact name exists. Add a unique login alias or a genuine contact differentiator, then review both stable IDs.", "已阻止：存在完全相同的姓名。请添加唯一登录别名或真实联系方式作为区分，并核对两个稳定 ID。");
    if (reason === "same_name_review") return copy(language, "Confirm that this is a different person with the same name.", "请确认这是同名但不同的学生。");
    return copy(language, "Check the entered details.", "请检查所填信息。");
  }

  async function submit() {
    if (busy || !serverPreview || !searchResponse) return;
    setBusy(true); setNotice(copy(language, "Repeating search and collision checks under server locks…", "正在服务器锁内重新执行搜索和冲突检查…"));
    try {
      const result = await createClubPreregistration(input, serverPreview, searchResponse, requestKey.current, reviewedSameName, clubIdentifier, legacyClubProof);
      setNotice(copy(language, `Pending account created · ${result.accountId.slice(0, 8)}. Login alias: ${result.loginAlias}. The temporary setup remains unchanged.`, `待完善账号已创建 · ${result.accountId.slice(0, 8)}。登录别名：${result.loginAlias}。临时设置流程保持不变。`));
      setInput(emptyInput()); setSearchQuery(""); setSearchResponse(null); setServerPreview(null); setReviewedSameName(false); setStep("search"); requestKey.current = crypto.randomUUID(); await onCreated();
    } catch (error) { setNotice(error instanceof Error ? error.message : copy(language, "No account was created.", "未创建账号。")); setStep("form"); setServerPreview(null); }
    finally { setBusy(false); }
  }

  return <section className="section-block preregister-panel" data-club-only="true">
    <div className="section-head"><div><p className="eyebrow">{copy(language, "Register new student", "注册新学生")}</p><h2>{copy(language, "Search first, then create only if needed", "先搜索，仅在需要时创建")}</h2><p className="section-subtitle">{copy(language, "Step 1 is mandatory. Results use stable IDs and masked contacts; selecting an existing student performs no write.", "第 1 步为必需步骤。结果使用稳定 ID 和遮掩后的联系方式；选择现有学生不会写入数据。")}</p></div><span className="status-chip"><ShieldAlert size={15}/>{copy(language, isTrustedOperatorContextActive() ? "Verified operator" : "Legacy Club gate", isTrustedOperatorContextActive() ? "已验证操作员" : "旧版俱乐部门控")}</span></div>

    <div className="preregister-step" aria-current={step === "search" ? "step" : undefined}><strong>{copy(language, "Step 1 · Search existing students", "第 1 步 · 搜索现有学生")}</strong>
      <form className="preregister-search" onSubmit={runSearch}><label><span className="sr-only">{copy(language, "Name, login alias, masked contact, or short ID", "姓名、登录别名、遮掩联系方式或短 ID")}</span><input aria-label={copy(language, "Search existing students", "搜索现有学生")} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchResponse(null); if (step !== "search") { setStep("search"); setServerPreview(null); } }} placeholder={copy(language, "Name, login alias, email/phone, or short ID", "姓名、登录别名、邮箱/电话或短 ID")} /></label><button className="primary-button" disabled={busy || !searchQuery.trim()} type="submit"><Search size={18}/>{copy(language, "Search", "搜索")}</button></form>
      {searchResponse ? <div className="student-results preregister-results" role="list" aria-label={copy(language, "Existing student search results", "现有学生搜索结果")}>{searchResponse.results.length ? searchResponse.results.map((item) => <div className="student-result" role="listitem" key={item.accountId}><span><strong>{item.studentName}</strong><em>{statusLabel(item.status, language)} · {item.maskedEmail || copy(language, "no email", "无邮箱")} · {item.maskedPhone || copy(language, "no phone", "无电话")} · ID {item.shortId}</em></span><button type="button" className="ghost-button" onClick={() => { const account = students.find((candidate) => candidate.id === item.accountId); if (account) onChooseExisting(account); else setNotice(copy(language, "Refresh the directory and search again.", "请刷新学生列表后重新搜索。")); }}><UserCheck size={17}/>{copy(language, "Choose existing", "选择现有账号")}</button></div>) : <p className="system-note">{copy(language, "No matching account.", "没有匹配账号。")}</p>}</div> : null}
      <button className="ghost-button" type="button" disabled={!searchResponse || busy} onClick={() => setStep("form")}><UserPlus size={18}/>{copy(language, "Continue to Step 2 for a different student", "不同学生：继续第 2 步")}</button>
    </div>

    {step === "form" ? <div className="preregister-step" aria-current="step"><strong>{copy(language, "Step 2 · New student details", "第 2 步 · 新学生信息")}</strong><p>{copy(language, "Student name is required. All other fields are optional; the existing temporary setup flow is unchanged.", "学生姓名为必填项，其他字段可选；现有临时设置流程不变。")}</p><div className="modal-field-grid preregister-fields">
      <label><span>{copy(language, "Student name", "学生姓名")} *</span><input autoFocus aria-label={copy(language, "Student name", "学生姓名")} value={input.studentName} maxLength={120} onChange={(event) => { setInput({ ...input, studentName: event.target.value }); setServerPreview(null); }}/></label>
      <label><span>{copy(language, "Login alias (optional)", "登录别名（可选）")}</span><input aria-label={copy(language, "Login alias", "登录别名")} value={input.loginAlias} maxLength={160} onChange={(event) => { setInput({ ...input, loginAlias: event.target.value }); setServerPreview(null); }}/></label>
      <label><span>{copy(language, "Email (optional)", "邮箱（可选）")}</span><input aria-label={copy(language, "Email", "邮箱")} type="email" value={input.email} maxLength={320} onChange={(event) => { setInput({ ...input, email: event.target.value }); setServerPreview(null); }}/></label>
      <label><span>{copy(language, "Phone (optional)", "电话（可选）")}</span><input aria-label={copy(language, "Phone", "电话")} inputMode="tel" value={input.phone} maxLength={30} onChange={(event) => { setInput({ ...input, phone: event.target.value }); setServerPreview(null); }}/></label>
    </div>
    {collisions.length ? <div className={`action-confirm-panel duplicate-student-panel ${decision.blocked ? "collision-blocked" : ""}`} aria-live="polite"><strong>{decision.blocked ? copy(language, "Creation blocked", "已阻止创建") : copy(language, "Review warnings", "核对警告")}</strong><p>{copy(language, "Exact and similar matches are warnings unless a hard collision rule applies. Nothing is merged or selected automatically.", "除非触发硬性冲突规则，否则完全或相似匹配仅为警告。系统不会自动合并或选择。")}</p><div className="student-results modal-results">{collisions.map((item) => <div className="student-result selected locked-selection" key={item.accountId}><span><strong>{item.studentName}</strong><em>{item.kinds.map((kind) => collisionLabel(kind, language)).join(" · ")} · {item.maskedEmail || copy(language, "no email", "无邮箱")} · {item.maskedPhone || copy(language, "no phone", "无电话")} · ID {item.accountId.slice(0, 8)}</em></span></div>)}</div>{collisions.some((item) => item.kinds.includes("exact_name")) ? <label className="same-name-review"><input type="checkbox" checked={reviewedSameName} onChange={(event) => setReviewedSameName(event.target.checked)}/><span>{copy(language, "I reviewed the stable IDs and confirm this is a different person with the same name.", "我已核对稳定 ID，并确认这是同名但不同的学生。")}</span></label> : null}</div> : null}
    <div className="modal-actions"><button className="ghost-button" type="button" disabled={busy} onClick={() => { setStep("search"); setServerPreview(null); }}><X size={18}/>{copy(language, "Back to search", "返回搜索")}</button><button className="primary-button" type="button" disabled={busy || decision.blocked || !searchResponse} onClick={() => void review()}><UserPlus size={18}/>{busy ? copy(language, "Checking…", "正在检查…") : copy(language, "Review preregistration", "检查预注册信息")}</button></div></div> : null}

    {step === "confirm" && serverPreview ? <div className="action-confirm-panel preregister-confirm" role="alertdialog" aria-labelledby="preregister-confirm-title"><strong id="preregister-confirm-title">{copy(language, "Final explicit confirmation", "最终明确确认")}</strong><p>{copy(language, `Create exactly one pending account for ${serverPreview.normalized.studentName}?`, `确定只为 ${serverPreview.normalized.studentName} 创建一个待完善账号吗？`)}</p>{exactNameCollisions.length ? <div className="stable-id-preview"><span>{copy(language, "Existing stable ID(s)", "现有稳定 ID")}: {exactNameCollisions.map((item) => item.accountId.slice(0, 8)).join(", ")}</span><span>{copy(language, "Proposed new stable ID", "拟创建的稳定 ID")}: {serverPreview.proposedAccountId.slice(0, 8)}</span></div> : null}<ul><li>{copy(language, "The server repeats search and collision checks atomically under deterministic locks.", "服务器会在确定性锁内原子地重新执行搜索和冲突检查。")}</li><li>{copy(language, "Exactly one redacted activity; no class, booking, bill, group, or package event.", "只创建一条已隐去敏感信息的活动记录；不会创建课程、预约、账单、团体或课包事件。")}</li><li>{copy(language, "First login remains setup-only and must replace the temporary password.", "首次登录仍仅可设置，并且必须更换临时密码。")}</li></ul><div className="modal-actions"><button className="ghost-button" disabled={busy} onClick={() => { setStep("form"); setServerPreview(null); }}><X size={18}/>{copy(language, "Back", "返回")}</button><button className="primary-button" disabled={busy || !hasVerifiedClubGate} onClick={() => void submit()}><Check size={18}/>{busy ? copy(language, "Checking…", "正在检查…") : copy(language, "Confirm pending account", "确认创建待完善账号")}</button></div></div> : null}
    {notice ? <p className="system-note" role="status" tabIndex={-1}>{notice}</p> : null}
  </section>;
}
