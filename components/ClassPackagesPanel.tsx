"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, History, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { listPackageBalances, listPackageHistory, setPackageOpening } from "@/lib/projectStore";
import {
  classPackageAccountRows,
  baseUnitsToDisplay,
  DEFAULT_PACKAGE_OPENING_AMOUNT,
  openingAmountToBaseUnits,
  PACKAGE_CATEGORIES,
  PACKAGE_CATEGORY_LABELS,
  safeAccountSuffix,
  searchClassPackageAccounts
} from "@/lib/classPackages";
import type { PackageBalance, PackageCategory, PackageLedgerEvent, ParentAccount } from "@/lib/types";

type Language = "en" | "zh";
const copy = (language: Language, en: string, zh: string) => language === "zh" ? zh : en;
const categoryLabel = (category: PackageCategory, language: Language) => PACKAGE_CATEGORY_LABELS[category][language];

function PackageAmount({ category, amountBaseUnits, language }: { category: PackageCategory; amountBaseUnits: number; language: Language }) {
  const unit = category === "group_class" ? copy(language, "class credits", "团体课次数") : copy(language, "hours", "小时");
  return <>{baseUnitsToDisplay(category, amountBaseUnits)} <small>{unit}</small></>;
}

export function ClassPackagesPanel({ students, language }: { students: ParentAccount[]; language: Language }) {
  const [balances, setBalances] = useState<PackageBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ParentAccount | null>(null);
  const [category, setCategory] = useState<PackageCategory>("coach_director_private");
  const [openingAmount, setOpeningAmount] = useState(String(DEFAULT_PACKAGE_OPENING_AMOUNT));
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [history, setHistory] = useState<PackageLedgerEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  function validateCompleteResponse(next: PackageBalance[]) {
    const expected = new Set(students.flatMap((student) => PACKAGE_CATEGORIES.map((item) => `${student.id}:${item}`)));
    const received = new Set(next.map((balance) => `${balance.studentAccountId}:${balance.category}`));
    if (received.size !== expected.size || [...expected].some((key) => !received.has(key))) {
      throw new Error(copy(language, "Package response omitted an account or category.", "课时包响应遗漏了账号或类别。"));
    }
  }

  async function refreshBalances() {
    const next = await listPackageBalances();
    validateCompleteResponse(next);
    setBalances(next);
  }

  useEffect(() => {
    let active = true;
    setLoadingBalances(true);
    listPackageBalances()
      .then((next) => {
        if (!active) return;
        validateCompleteResponse(next);
        setBalances(next);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : copy(language, "Could not load packages.", "无法加载课时包。")))
      .finally(() => active && setLoadingBalances(false));
    return () => { active = false; };
    // Student IDs and language are the complete response contract for this view.
  }, [students, language]);

  const rows = useMemo(() => classPackageAccountRows(students, balances), [students, balances]);
  const visibleRows = useMemo(() => searchClassPackageAccounts(rows, query), [rows, query]);
  const selectedRow = selected ? rows.find((row) => row.account.id === selected.id) : null;
  const selectedBalance = selectedRow?.packages[category] ?? null;
  const parsedAmount = Number(openingAmount);
  let newOpeningAmountBaseUnits: number | null = null;
  try { newOpeningAmountBaseUnits = openingAmount.trim() === "" ? null : openingAmountToBaseUnits(category, parsedAmount); } catch { newOpeningAmountBaseUnits = null; }

  async function refreshHistory(account: ParentAccount, nextCategory: PackageCategory) {
    setLoadingHistory(true);
    try {
      setHistory(await listPackageHistory(account.id, nextCategory));
    } finally {
      setLoadingHistory(false);
    }
  }

  function openManager(account: ParentAccount, nextCategory: PackageCategory) {
    const row = rows.find((item) => item.account.id === account.id);
    const balance = row?.packages[nextCategory];
    setSelected(account);
    setCategory(nextCategory);
    setOpeningAmount(baseUnitsToDisplay(nextCategory, balance?.openingAmountBaseUnits ?? 0));
    setNote("");
    setReference("");
    setHistory([]);
    setError("");
    idempotencyKey.current = crypto.randomUUID();
    void refreshHistory(account, nextCategory).catch((caught) => setError(caught instanceof Error ? caught.message : copy(language, "Could not load history.", "无法加载历史记录。")));
  }

  function changeCategory(nextCategory: PackageCategory) {
    if (!selected || saving) return;
    const next = selectedRow?.packages[nextCategory];
    setCategory(nextCategory);
    setOpeningAmount(baseUnitsToDisplay(nextCategory, next?.openingAmountBaseUnits ?? 0));
    setHistory([]);
    setError("");
    idempotencyKey.current = crypto.randomUUID();
    void refreshHistory(selected, nextCategory).catch((caught) => setError(caught instanceof Error ? caught.message : copy(language, "Could not load history.", "无法加载历史记录。")));
  }

  async function submit() {
    if (!selected || !selectedBalance || newOpeningAmountBaseUnits === null || saving) return;
    setSaving(true);
    setError("");
    try {
      await setPackageOpening({
        studentAccountId: selected.id,
        category,
        openingAmount: parsedAmount,
        expectedOpeningAmountBaseUnits: selectedBalance.openingAmountBaseUnits,
        expectedVersion: selectedBalance.version,
        note,
        reference,
        idempotencyKey: idempotencyKey.current
      });
      await refreshBalances();
      await refreshHistory(selected, category);
      setNote("");
      setReference("");
      idempotencyKey.current = crypto.randomUUID();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy(language, "Could not set opening amount.", "无法设置期初数量。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="class-packages" data-club-only="true">
      <section className="section-block package-hero">
        <div className="section-head">
          <div>
            <p className="eyebrow">{copy(language, "Manage packages", "管理课时包")}</p>
            <h2>{copy(language, "Explicit package units by account and category", "按账号和明确类别管理课时包单位")}</h2>
            <p className="section-subtitle">{copy(language, "Opening units, adjustments, and explicit usage stay separate. Historical bookings are never inferred or reclassified.", "期初单位、调整和明确使用量分别记录。绝不推断或重新分类历史预约。")}</p>
          </div>
          <span className="status-chip good"><ShieldCheck size={15} /> {copy(language, "Append-only history", "只追加历史")}</span>
        </div>
        <div className="package-scope-note">
          <strong>{copy(language, "Safe scope", "安全范围")}</strong>
          <span>{copy(language, "Private packages use nonnegative 0.5-hour increments; group packages use nonnegative whole class credits. Every edit preserves other categories.", "私教课时包以非负 0.5 小时递增；团体课时包使用非负整数课次。每次编辑保留其他类别。")}</span>
        </div>
        <div className="package-scope-note warning" role="note">
          <strong>{copy(language, "Temporary security limitation", "临时安全限制")}</strong>
          <span>{copy(language, "Club access still uses the legacy unverified session; events honestly record that actor until server-verified Club sign-in ships.", "俱乐部访问仍使用未验证的旧会话；在服务器验证登录上线前，事件会如实记录该操作者。")}</span>
        </div>
        <label className="search package-search"><Search size={18} /><input aria-label={copy(language, "Search by student name or account ID", "按学生姓名或账号 ID 搜索")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy(language, "Search name or account ID", "搜索姓名或账号 ID")} /></label>
      </section>

      <section className="section-block package-directory" aria-label={copy(language, "Student package accounts", "学生课时包账号")}>
        {loadingBalances ? <p className="empty-state" aria-live="polite">{copy(language, "Loading shared packages…", "正在加载共享课时包…")}</p> : null}
        {error && !selected ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="package-account-list" aria-busy={loadingBalances}>
          {visibleRows.map((row) => (
            <article className="package-account-row" key={row.account.id} data-account-id={row.account.id}>
              <div className="package-identity">
                <strong>{row.account.studentName}{row.duplicateName ? ` · ${safeAccountSuffix(row.account.id)}` : ""}</strong>
                <code>{copy(language, "Account", "账号")} {row.account.id}</code>
              </div>
              <div className="package-category-list">
                {PACKAGE_CATEGORIES.map((item) => (
                  <div className="package-category-row" key={item} data-package-category={item}>
                    <span>{categoryLabel(item, language)}</span>
                    <strong><PackageAmount category={item} amountBaseUnits={row.packages[item].remainingAmountBaseUnits} language={language} /></strong>
                    <button className="ghost-button package-manage-button" disabled={loadingBalances || Boolean(error)} onClick={() => openManager(row.account, item)}><SlidersHorizontal size={15} /> {copy(language, "Manage", "管理")}</button>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {visibleRows.length === 0 ? <p className="empty-state">{copy(language, "No matching student account.", "未找到匹配的学生账号。")}</p> : null}
        </div>
        <p className="package-count">{copy(language, `${visibleRows.length} of ${rows.length} accounts · 3 explicit categories each`, `显示 ${visibleRows.length} / ${rows.length} 个账号 · 每个账号 3 个明确类别`)}</p>
      </section>

      {selected && selectedBalance ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal package-modal" role="dialog" aria-modal="true" aria-labelledby="manage-package-title">
            <button className="icon-button package-modal-close" aria-label={copy(language, "Close", "关闭")} onClick={() => setSelected(null)} disabled={saving}><X size={18} /></button>
            <p className="eyebrow">{copy(language, "Manage package", "管理课时包")}</p>
            <h2 id="manage-package-title">{selected.studentName}{selectedRow?.duplicateName ? ` · ${safeAccountSuffix(selected.id)}` : ""}</h2>
            <code className="package-account-code">{selected.id}</code>
            <label className="package-category-select"><span>{copy(language, "Package category", "课时包类别")}</span><select value={category} onChange={(event) => changeCategory(event.target.value as PackageCategory)} disabled={saving}>{PACKAGE_CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item, language)}</option>)}</select></label>
            <dl className="package-metrics">
              <div><dt>{copy(language, "Opening", "期初")}</dt><dd><PackageAmount category={category} amountBaseUnits={selectedBalance.openingAmountBaseUnits} language={language} /></dd></div>
              <div><dt>{copy(language, "Adjustments", "调整")}</dt><dd><PackageAmount category={category} amountBaseUnits={selectedBalance.adjustmentAmountBaseUnits} language={language} /></dd></div>
              <div><dt>{copy(language, "Explicit usage", "明确使用")}</dt><dd><PackageAmount category={category} amountBaseUnits={selectedBalance.usageAmountBaseUnits} language={language} /></dd></div>
              <div><dt>{copy(language, "Remaining", "剩余")}</dt><dd><PackageAmount category={category} amountBaseUnits={selectedBalance.remainingAmountBaseUnits} language={language} /></dd></div>
            </dl>
            <div className="modal-field-grid">
              <label><span>{category === "group_class" ? copy(language, "Set opening class credits", "设置期初团体课次数") : copy(language, "Set opening hours", "设置期初小时数")}</span><input className="modal-input" aria-label={category === "group_class" ? copy(language, "Set opening class credits", "设置期初团体课次数") : copy(language, "Set opening hours", "设置期初小时数")} type="number" min="0" max={category === "group_class" ? 10000 : 500} step={category === "group_class" ? 1 : 0.5} value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></label>
              <label><span>{copy(language, "Reference (optional)", "参考号（可选）")}</span><input className="modal-input" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} /></label>
            </div>
            <label className="package-note"><span>{copy(language, "Note (optional)", "备注（可选）")}</span><input className="modal-input" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
            {newOpeningAmountBaseUnits === null ? <p className="form-error" role="alert">{category === "group_class" ? copy(language, "Use a nonnegative whole number of class credits. Zero is valid.", "请输入非负整数团体课次数。零有效。") : copy(language, "Use 0–500 hours in 0.5-hour increments. Zero is valid.", "请输入 0–500 小时并以 0.5 小时递增。零有效。")}</p> : (
              <div className="package-result" aria-live="polite"><span>{copy(language, "Opening change", "期初变更")}</span><strong>{baseUnitsToDisplay(category, selectedBalance.openingAmountBaseUnits)} → {baseUnitsToDisplay(category, newOpeningAmountBaseUnits)}</strong><span>{copy(language, "Resulting remaining", "变更后剩余")}</span><strong><PackageAmount category={category} amountBaseUnits={selectedBalance.remainingAmountBaseUnits - selectedBalance.openingAmountBaseUnits + newOpeningAmountBaseUnits} language={language} /></strong></div>
            )}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="package-history">
              <h3><History size={17} /> {copy(language, "History", "历史记录")}</h3>
              {loadingHistory ? <p>{copy(language, "Loading history…", "正在加载历史记录…")}</p> : history.length === 0 ? <p>{copy(language, "No events yet.", "暂无事件。")}</p> : (
                <ol>{history.map((event) => <li key={event.eventId}><strong>{event.eventType === "opening_set" ? `${baseUnitsToDisplay(event.category, event.oldOpeningAmountBaseUnits ?? 0)} → ${baseUnitsToDisplay(event.category, event.newOpeningAmountBaseUnits ?? 0)}` : `${event.amountBaseUnits > 0 ? "+" : ""}${baseUnitsToDisplay(event.category, event.amountBaseUnits)}`}</strong><span>{new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))} · v{event.version}</span>{event.note ? <span>{event.note}</span> : null}</li>)}</ol>
              )}
            </div>
            <div className="modal-actions"><button className="ghost-button" onClick={() => setSelected(null)} disabled={saving}>{copy(language, "Close", "关闭")}</button><button className="primary-button" onClick={submit} disabled={saving || newOpeningAmountBaseUnits === null}><Check size={18} /> {saving ? copy(language, "Saving…", "正在保存…") : copy(language, "Set opening", "设置期初课时")}</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
