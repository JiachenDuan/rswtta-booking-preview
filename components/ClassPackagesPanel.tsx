"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Plus, Search, ShieldCheck, X } from "lucide-react";
import { addLocalPackageHours, listLocalPackageHoursLedger } from "@/lib/projectStore";
import {
  classPackageAccountRows,
  DEFAULT_PACKAGE_HOURS,
  hoursToMinutes,
  minutesToHoursText,
  safeAccountSuffix,
  searchClassPackageAccounts
} from "@/lib/classPackages";
import type { PackageHoursLedgerEntry, ParentAccount } from "@/lib/types";

type Language = "en" | "zh";
const copy = (language: Language, en: string, zh: string) => language === "zh" ? zh : en;

export function ClassPackagesPanel({ students, language }: { students: ParentAccount[]; language: Language }) {
  const [entries, setEntries] = useState<PackageHoursLedgerEntry[]>(() => listLocalPackageHoursLedger());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ParentAccount | null>(null);
  const [hours, setHours] = useState(String(DEFAULT_PACKAGE_HOURS));
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => setEntries(listLocalPackageHoursLedger()), []);

  const rows = useMemo(() => classPackageAccountRows(students, entries), [students, entries]);
  const visibleRows = useMemo(() => searchClassPackageAccounts(rows, query), [rows, query]);
  const selectedRow = selected ? rows.find((row) => row.account.id === selected.id) : null;
  const parsedHours = Number(hours);
  let addedMinutes: number | null = null;
  try { addedMinutes = hoursToMinutes(parsedHours); } catch { addedMinutes = null; }

  async function submit() {
    if (!selected || addedMinutes === null || saving) return;
    setSaving(true);
    setError("");
    try {
      await addLocalPackageHours({
        studentAccountId: selected.id,
        hours: parsedHours,
        note,
        reference,
        idempotencyKey: idempotencyKey.current
      });
      setEntries(listLocalPackageHoursLedger());
      setSelected(null);
      setHours(String(DEFAULT_PACKAGE_HOURS));
      setNote("");
      setReference("");
      idempotencyKey.current = crypto.randomUUID();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy(language, "Could not add hours.", "无法增加课时。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="class-packages" data-club-only="true">
      <section className="section-block package-hero">
        <div className="section-head">
          <div>
            <p className="eyebrow">{copy(language, "Class packages", "课时包")}</p>
            <h2>{copy(language, "Prepaid hours by student account", "按学生账号管理预付课时")}</h2>
            <p className="section-subtitle">
              {copy(language, "Every current student account is shown. Balances are derived from an append-only minutes ledger.", "显示所有当前学生账号。余额由只追加的分钟账本计算。")}
            </p>
          </div>
          <span className="status-chip good"><ShieldCheck size={15} /> {copy(language, "Local review", "本地审核")}</span>
        </div>
        <div className="package-scope-note">
          <strong>{copy(language, "Phase 1 scope", "第一阶段范围")}</strong>
          <span>{copy(language, "Add prepaid hours only. No automatic lesson deductions, payment amounts, refunds, or arbitrary balance edits.", "仅增加预付课时。不包含自动扣课时、付款金额、退款或任意修改余额。")}</span>
        </div>
        <label className="search package-search">
          <Search size={18} />
          <input aria-label={copy(language, "Search by student name or account ID", "按学生姓名或账号 ID 搜索")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy(language, "Search name or account ID", "搜索姓名或账号 ID")} />
        </label>
      </section>

      <section className="section-block package-directory" aria-label={copy(language, "Student class package accounts", "学生课时包账号")}>
        <div className="package-table-head" aria-hidden="true">
          <span>{copy(language, "Student account", "学生账号")}</span>
          <span>{copy(language, "Status", "状态")}</span>
          <span>{copy(language, "Hours remaining", "剩余课时")}</span>
          <span>{copy(language, "Last package update", "最近更新")}</span>
          <span />
        </div>
        <div className="package-account-list">
          {visibleRows.map((row) => (
            <article className="package-account-row" key={row.account.id} data-account-id={row.account.id}>
              <div className="package-identity">
                <strong>{row.account.studentName}{row.duplicateName ? ` · ${safeAccountSuffix(row.account.id)}` : ""}</strong>
                <code>{copy(language, "Account", "账号")} {row.account.id}</code>
              </div>
              <span className={`status-chip ${row.account.profileSetupRequired ? "" : "good"}`}>
                {row.account.profileSetupRequired ? copy(language, "Setup required", "待完善资料") : copy(language, "Profile complete", "资料完整")}
              </span>
              <strong className="package-balance">{minutesToHoursText(row.balanceMinutes)} <small>{copy(language, "hours", "课时")}</small></strong>
              <span className="package-updated">{row.lastUpdatedAt ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.lastUpdatedAt)) : copy(language, "No updates yet", "暂无更新")}</span>
              <button className="primary-button package-add-button" onClick={() => { setSelected(row.account); setError(""); idempotencyKey.current = crypto.randomUUID(); }}>
                <Plus size={17} /> {copy(language, "Add hours", "增加课时")}
              </button>
            </article>
          ))}
          {visibleRows.length === 0 ? <p className="empty-state">{copy(language, "No matching student account.", "未找到匹配的学生账号。")}</p> : null}
        </div>
        <p className="package-count">{copy(language, `${visibleRows.length} of ${rows.length} accounts`, `显示 ${visibleRows.length} / ${rows.length} 个账号`)}</p>
      </section>

      {selected && selectedRow ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal package-modal" role="dialog" aria-modal="true" aria-labelledby="add-package-title">
            <button className="icon-button package-modal-close" aria-label={copy(language, "Close", "关闭")} onClick={() => setSelected(null)} disabled={saving}><X size={18} /></button>
            <p className="eyebrow">{copy(language, "Add hours", "增加课时")}</p>
            <h2 id="add-package-title">{copy(language, "Confirm package credit", "确认增加课时")}</h2>
            <dl className="confirm-summary package-confirm-summary">
              <div><dt>{copy(language, "Student", "学生")}</dt><dd>{selected.studentName}</dd></div>
              <div><dt>{copy(language, "Permanent account ID", "永久账号 ID")}</dt><dd><code>{selected.id}</code></dd></div>
              <div><dt>{copy(language, "Current balance", "当前余额")}</dt><dd>{minutesToHoursText(selectedRow.balanceMinutes)} {copy(language, "hours", "课时")}</dd></div>
            </dl>
            <div className="modal-field-grid">
              <label><span>{copy(language, "Hours to add", "增加课时")}</span><input className="modal-input" type="number" min="0.5" max="500" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
              <label><span>{copy(language, "Reference (optional)", "参考号（可选）")}</span><input className="modal-input" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} /></label>
            </div>
            <label className="package-note"><span>{copy(language, "Note (optional)", "备注（可选）")}</span><input className="modal-input" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
            {addedMinutes === null ? <p className="form-error" role="alert">{copy(language, "Use a positive amount up to 500 hours in 0.5-hour increments.", "请输入以 0.5 课时递增的正数，最多 500 课时。")}</p> : (
              <div className="package-result" aria-live="polite"><Clock3 size={20} /><span>{copy(language, "Resulting balance", "增加后余额")}</span><strong>{minutesToHoursText(selectedRow.balanceMinutes + addedMinutes)} {copy(language, "hours", "课时")}</strong></div>
            )}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setSelected(null)} disabled={saving}>{copy(language, "Cancel", "取消")}</button>
              <button className="primary-button" onClick={submit} disabled={saving || addedMinutes === null}>
                <Check size={18} /> {saving ? copy(language, "Adding…", "正在增加…") : copy(language, `Add ${addedMinutes === null ? "" : minutesToHoursText(addedMinutes)} hours`, `增加 ${addedMinutes === null ? "" : minutesToHoursText(addedMinutes)} 课时`)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
