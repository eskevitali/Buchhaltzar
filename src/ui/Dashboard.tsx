import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "obsidian";
import { calculateBalances, calculateMediumBalances, cashTotal } from "../core/ledger";
import { formatMoney, parseAmount } from "../core/money";
import { isPurposeAccount, mediumFromPaymentMethod, type Account, type Medium, type Transaction, type TransactionInput, type TransactionType } from "../core/types";
import { buildExpenseSplitItems } from "../core/splits";
import type { BuchhaltzarService } from "../application/service";
import type { AiProvider, AiTransactionDraft } from "../ai/types";
import lokvitaMark from "../assets/lokvita-mark.png";
import type { ReportPeriod } from "../core/report";

interface Props { service: BuchhaltzarService; getAiProvider: () => AiProvider | null; openPath: (path: string) => Promise<void>; }
type Draft = { type: Exclude<TransactionType, "reversal">; amount: string; accountId: string; fromAccountId: string; toAccountId: string; date: string; medium: Medium; categoryId: string; counterparty: string; comment: string };
type ExpenseSplit = { id: string; amount: string; accountId: string };

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function receiptImages(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Не удалось открыть изображение")); element.src = url; });
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return [canvas.toDataURL("image/jpeg", .9)];
  } finally { URL.revokeObjectURL(url); }
}
const initialDraft = (): Draft => ({ type: "expense", amount: "", accountId: "urgent", fromAccountId: "urgent", toAccountId: "business", date: today(), medium: "cashless", categoryId: "", counterparty: "", comment: "" });
const mediumLabels: Record<Medium, string> = { cashless: "счёт", cash: "касса" };
const typeLabels: Record<Draft["type"], string> = { income: "Приход", "main-income": "Основной приход", expense: "Расход", transfer: "Перевод" };

export function Dashboard({ service, getAiProvider, openPath }: Props): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplit[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("month");
  const [reportDate, setReportDate] = useState(today);
  const [reportPath, setReportPath] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);

  const reload = useCallback(async () => {
    const snapshot = await service.snapshot();
    setAccounts(snapshot.accounts); setTransactions(snapshot.transactions); setDiagnostics(snapshot.diagnostics);
  }, [service]);

  useEffect(() => { void reload(); }, [reload]);
  const balances = useMemo(() => calculateBalances(accounts, transactions, service.settings.baseCurrency), [accounts, transactions, service]);
  const mediumBalances = useMemo(() => calculateMediumBalances(accounts, transactions, service.settings.baseCurrency), [accounts, transactions, service]);
  const purpose = accounts.filter((account) => account.kind === "asset" && account.active && isPurposeAccount(account.id));
  const reversed = new Set(transactions.map((transaction) => transaction.reverses).filter(Boolean));
  const total = purpose.reduce((sum, account) => sum + (balances.get(account.id) ?? 0n), 0n);
  const cashOnHand = cashTotal(mediumBalances);
  const splitRemainder = useMemo(() => {
    try { return parseAmount(draft.amount, service.settings.baseCurrency) - expenseSplits.reduce((sum, row) => sum + parseAmount(row.amount, service.settings.baseCurrency), 0n); }
    catch { return null; }
  }, [draft.amount, expenseSplits, service]);

  function applyAiDraft(ai: AiTransactionDraft): void {
    if (ai.currency.toUpperCase() !== service.settings.baseCurrency) new Notice(`Чек распознан в ${ai.currency}; форма использует ${service.settings.baseCurrency}. Проверьте сумму.` , 7000);
    const valid = (id: string | undefined, fallback: string) => purpose.some((account) => account.id === id) ? id! : fallback;
    setDraft({
      type: ai.type, amount: ai.amount.replace(".", ","), date: ai.effectiveDate,
      accountId: valid(ai.accountId, ai.type === "expense" ? "urgent" : "business"),
      fromAccountId: valid(ai.fromAccountId, "urgent"), toAccountId: valid(ai.toAccountId, "business"),
      medium: mediumFromPaymentMethod(ai.paymentMethod), categoryId: ai.categoryId ?? "", counterparty: ai.counterparty ?? "", comment: ai.comment ?? ""
    });
    setExpenseSplits([]); setSplitOpen(false);
  }

  async function toggleRecording(): Promise<void> {
    if (recorder.current && recording) { recorder.current.stop(); return; }
    const provider = getAiProvider(); if (!provider) { new Notice("Настройте ИИ-провайдер и API-ключ"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks: Blob[] = [];
      const mediaRecorder = new MediaRecorder(stream); recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      mediaRecorder.onstop = () => { setRecording(false); stream.getTracks().forEach((track) => track.stop()); setBusy(true); void provider.transcribe(new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" })).then((text) => provider.interpretText(text, service.settings.baseCurrency)).then((ai) => { applyAiDraft(ai); new Notice(`Распознано: ${ai.sourceText ?? "голосовая операция"}`, 7000); }).catch((error) => new Notice(error instanceof Error ? error.message : String(error), 8000)).finally(() => setBusy(false)); };
      mediaRecorder.start(); setRecording(true); new Notice("Запись началась. Нажмите ещё раз для остановки.");
    } catch (error) { new Notice(`Микрофон недоступен: ${error instanceof Error ? error.message : String(error)}`, 7000); }
  }

  async function recognizeReceipt(file: File): Promise<void> {
    const provider = getAiProvider(); if (!provider) { new Notice("Настройте ИИ-провайдер и API-ключ"); return; }
    setBusy(true);
    try {
      const ai = await provider.recognizeReceipt(await receiptImages(file), service.settings.baseCurrency); applyAiDraft(ai); setReceiptFile(file);
      new Notice(`Распознан итог чека: ${ai.amount} ${ai.currency}. При необходимости разделите расход вручную.`, 8000);
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 8000); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true);
    try {
      const input: TransactionInput = {
        type: draft.type, amount: parseAmount(draft.amount, service.settings.baseCurrency), currency: service.settings.baseCurrency,
        effectiveDate: draft.date, accountId: draft.accountId, fromAccountId: draft.fromAccountId,
        toAccountId: draft.toAccountId, comment: draft.comment, medium: draft.medium, paymentMethod: draft.medium,
        categoryId: draft.categoryId || undefined, counterparty: draft.counterparty || undefined,
        receiptItems: draft.type === "expense" ? buildExpenseSplitItems(parseAmount(draft.amount, service.settings.baseCurrency), draft.accountId, expenseSplits.map((row) => ({ minorUnits: parseAmount(row.amount, service.settings.baseCurrency), accountId: row.accountId }))) : undefined
      };
      const preview = await service.preview(input);
      const lines = preview.transaction.postings.map((posting) => {
        const name = accounts.find((account) => account.id === posting.accountId)?.name ?? posting.accountId;
        const form = posting.medium ? `, ${mediumLabels[posting.medium]}` : "";
        return `${name}${form}: ${formatMoney(posting.minorUnits, preview.transaction.currency, service.settings.locale)}`;
      });
      const warning = preview.insufficientAccounts.length ? `\n\nВнимание: отрицательный остаток: ${preview.insufficientAccounts.map((id) => accounts.find((account) => account.id === id)?.name ?? id).join(", ")}.` : "";
      if (!window.confirm(`Подтвердить операцию?\n\n${lines.join("\n")}${warning}`)) return;
      const extension = receiptFile?.name.split(".").pop() || (receiptFile?.type === "image/png" ? "png" : "jpg");
      await service.confirm(preview.transaction, receiptFile ? { data: await receiptFile.arrayBuffer(), extension } : undefined);
      const hadReceipt = Boolean(receiptFile); setDraft(initialDraft()); setReceiptFile(null); setExpenseSplits([]); setSplitOpen(false); await reload(); new Notice(hadReceipt ? "Операция и чек сохранены" : "Операция сохранена");
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 6000); }
    finally { setBusy(false); }
  }

  async function reverse(id: string): Promise<void> {
    if (!window.confirm("Создать обратную операцию? Исходная запись сохранится.")) return;
    setBusy(true);
    try { await service.reverse(id); await reload(); new Notice("Сторно создано"); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error), 6000); }
    finally { setBusy(false); }
  }

  async function createReport(): Promise<void> {
    setBusy(true);
    try {
      const report = await service.createArchiveReport(reportPeriod, reportDate);
      setReportPath(report.path);
      new Notice(`Отчёт создан: ${report.range.title}. Транзакций: ${report.transactionCount}`);
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); }
    finally { setBusy(false); }
  }

  return <div className="buchhaltzar">
    <header className="buchhaltzar__header"><div className="buchhaltzar__brand"><img src={lokvitaMark} alt="" width="40" height="40"/><div><div className="buchhaltzar__eyebrow">LOKVITA · GRAVITON</div><h1>Buchhaltzar</h1></div></div><div className="buchhaltzar__total"><span>Учтено</span><strong>{formatMoney(total, service.settings.baseCurrency, service.settings.locale)}</strong></div></header>

    <section><h2>Счета</h2><div className="buchhaltzar__accounts">
      {purpose.map((account) => {
        const layers = mediumBalances.get(account.id) ?? { cash: 0n, cashless: 0n };
        return <article className="buchhaltzar__account" key={account.id}>
          <span>{account.name}</span>
          <div className="buchhaltzar__account-layers">
            <small><em>счёт</em><b>{formatMoney(layers.cashless, service.settings.baseCurrency, service.settings.locale)}</b></small>
            <small><em>касса</em><b>{formatMoney(layers.cash, service.settings.baseCurrency, service.settings.locale)}</b></small>
          </div>
          <strong>{formatMoney(balances.get(account.id) ?? 0n, service.settings.baseCurrency, service.settings.locale)}</strong>
        </article>;
      })}
      <article className="buchhaltzar__account is-cash">
        <span>Касса</span>
        <small className="buchhaltzar__account-note">наличные по всем счетам</small>
        <strong>{formatMoney(cashOnHand, service.settings.baseCurrency, service.settings.locale)}</strong>
      </article>
    </div></section>

    <section className="buchhaltzar__panel"><h2>Новая операция</h2><form onSubmit={(event) => void submit(event)}>
      {service.settings.ai.enabled && <div className="buchhaltzar__ai-tools">
        <button type="button" className={recording ? "mod-warning" : ""} onClick={() => void toggleRecording()} disabled={busy}>{recording ? "Остановить запись" : "Голосовой ввод"}</button>
        <label className="buchhaltzar__receipt-button">Сфотографировать чек<input type="file" accept="image/*" capture="environment" disabled={busy || recording} onChange={(event) => { const file = event.target.files?.[0]; if (file) void recognizeReceipt(file); event.target.value = ""; }}/></label>
        <label className="buchhaltzar__receipt-button">Выбрать из галереи<input type="file" accept="image/*" disabled={busy || recording} onChange={(event) => { const file = event.target.files?.[0]; if (file) void recognizeReceipt(file); event.target.value = ""; }}/></label>
      </div>}
      {receiptFile && <div className="buchhaltzar__attachment"><span>Чек: {receiptFile.name}</span><button type="button" onClick={() => { setReceiptFile(null); setDraft(initialDraft()); setExpenseSplits([]); setSplitOpen(false); }} disabled={busy}>Убрать</button></div>}
      <label>Тип<select value={draft.type} onChange={(event) => { const type = event.target.value as Draft["type"]; setDraft({ ...draft, type }); if (type !== "expense") { setReceiptFile(null); setExpenseSplits([]); setSplitOpen(false); } }}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="buchhaltzar__row"><label>Сумма<input required inputMode="decimal" placeholder="0,00" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })}/></label><label>Дата<input required type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })}/></label></div>
      {(draft.type === "income" || draft.type === "expense") && <label>{draft.type === "income" ? "Зачислить на счёт" : "Основной счёт списания"}<select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>{purpose.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
      {draft.type === "expense" && <button type="button" onClick={() => { const opening = !splitOpen; setSplitOpen(opening); if (opening && !expenseSplits.length) setExpenseSplits([{ id: `${Date.now()}`, amount: "", accountId: "urgent" }]); if (!opening) setExpenseSplits([]); }}>{splitOpen ? "Отменить разделение" : "Разделить расход"}</button>}
      {draft.type === "expense" && splitOpen && <div className="buchhaltzar__split-table">
        <div className="buchhaltzar__receipt-heading"><strong>Распределение расхода</strong><span className={splitRemainder !== null && splitRemainder >= 0n ? "is-match" : "is-mismatch"}>{splitRemainder === null ? "Введите корректные суммы" : `Остаток: ${formatMoney(splitRemainder, service.settings.baseCurrency, service.settings.locale)}`}</span></div>
        {expenseSplits.map((row, index) => <div className="buchhaltzar__split-row" key={row.id}><span>{index + 1}</span><input aria-label={`Сумма части ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={row.amount} onChange={(event) => setExpenseSplits(expenseSplits.map((item) => item.id === row.id ? { ...item, amount: event.target.value } : item))}/><select aria-label={`Счёт части ${index + 1}`} value={row.accountId} onChange={(event) => setExpenseSplits(expenseSplits.map((item) => item.id === row.id ? { ...item, accountId: event.target.value } : item))}>{purpose.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button type="button" aria-label={`Удалить часть ${index + 1}`} onClick={() => setExpenseSplits(expenseSplits.filter((item) => item.id !== row.id))}>×</button></div>)}
        <button type="button" onClick={() => setExpenseSplits([...expenseSplits, { id: `${Date.now()}`, amount: "", accountId: "urgent" }])}>+ Добавить часть</button>
        <p className="buchhaltzar__hint">Нераспределённый остаток будет списан с основного счёта.</p>
      </div>}
      {draft.type === "main-income" && <p className="buchhaltzar__hint">Сумма будет поровну распределена между счетами «Срочные», «Бизнес», «Фонд», «Капитал» и «Будущее» в выбранной форме: наличные или безналичные.</p>}
      {draft.type === "transfer" && <div className="buchhaltzar__row"><label>Со счёта<select value={draft.fromAccountId} onChange={(event) => setDraft({ ...draft, fromAccountId: event.target.value })}>{purpose.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>На счёт<select value={draft.toAccountId} onChange={(event) => setDraft({ ...draft, toAccountId: event.target.value })}>{purpose.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>}
      <div className="buchhaltzar__row"><label>Форма<select value={draft.medium} onChange={(event) => setDraft({ ...draft, medium: event.target.value as Medium })}><option value="cashless">Безналичные</option><option value="cash">Наличные</option></select></label><label>Категория<input placeholder="Например, продукты" value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}/></label></div>
      <label>Контрагент<input placeholder="Магазин или источник" value={draft.counterparty} onChange={(event) => setDraft({ ...draft, counterparty: event.target.value })}/></label>
      <label>Комментарий<input placeholder="Необязательно" value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })}/></label>
      <button className="mod-cta" type="submit" disabled={busy}>Проверить и провести</button>
    </form></section>

    <section className="buchhaltzar__report-panel">
      <div className="buchhaltzar__section-title"><div><h2>Архивный отчёт</h2><p className="buchhaltzar__hint">Сводка и расшифровка транзакций сохраняются одним файлом в Reports.</p></div></div>
      <div className="buchhaltzar__report-controls">
        <label>Период<select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as ReportPeriod)}><option value="week">Неделя</option><option value="month">Месяц</option><option value="quarter">Квартал</option><option value="year">Год</option></select></label>
        <label>Дата внутри периода<input type="date" required value={reportDate} onChange={(event) => setReportDate(event.target.value)}/></label>
        <button type="button" onClick={() => void createReport()} disabled={busy || !reportDate}>Сформировать</button>
      </div>
      {reportPath && <div className="buchhaltzar__report-result"><span>Готово: {reportPath}</span><button type="button" onClick={() => void openPath(reportPath)}>Открыть отчёт</button></div>}
    </section>

    <section><div className="buchhaltzar__section-title"><h2>Журнал</h2><button type="button" onClick={() => void reload()} disabled={busy}>Обновить</button></div>
      {!transactions.length && <p className="buchhaltzar__empty">Проведённых операций пока нет.</p>}
      <div className="buchhaltzar__transactions">{transactions.slice(0, 50).map((transaction) => { const first = transaction.postings[0]?.minorUnits ?? 0n; const amount = first < 0n ? -first : first; return <article key={transaction.id} className="buchhaltzar__transaction"><div><strong>{typeLabels[transaction.type as Draft["type"]] ?? "Сторно"}</strong><span>{transaction.effectiveDate} · {transaction.comment || "Без комментария"}</span></div><div className="buchhaltzar__transaction-actions"><span>{formatMoney(amount, transaction.currency, service.settings.locale)}</span>{transaction.type !== "reversal" && !reversed.has(transaction.id) && <button type="button" onClick={() => void reverse(transaction.id)} disabled={busy}>Сторно</button>}</div></article>; })}</div>
    </section>
    {!!diagnostics.length && <details className="buchhaltzar__diagnostics"><summary>Диагностика: {diagnostics.length}</summary>{diagnostics.map((item) => <code key={item}>{item}</code>)}</details>}
  </div>;
}
