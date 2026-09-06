import { formatMoney } from "./money";
import type { Account, Transaction, TransactionType } from "./types";

export type ReportPeriod = "week" | "month" | "quarter" | "year";

export interface ReportRange {
  start: string;
  end: string;
  title: string;
}

export interface ArchiveReport {
  filename: string;
  content: string;
  range: ReportRange;
  transactionCount: number;
}

const periodLabels: Record<ReportPeriod, string> = {
  week: "Неделя",
  month: "Месяц",
  quarter: "Квартал",
  year: "Год"
};

const transactionLabels: Record<TransactionType, string> = {
  income: "Приход",
  "main-income": "Основной приход",
  expense: "Расход",
  transfer: "Перевод",
  reversal: "Сторно"
};

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Некорректная дата отчёта");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (isoDate(date) !== value) throw new Error("Некорректная дата отчёта");
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function getReportRange(period: ReportPeriod, anchorDate: string): ReportRange {
  const anchor = parseDate(anchorDate);
  let start: Date;
  let end: Date;
  let title: string;

  if (period === "week") {
    const daysFromMonday = (anchor.getUTCDay() + 6) % 7;
    start = addDays(anchor, -daysFromMonday);
    end = addDays(start, 6);
    title = `Неделя ${displayDate(isoDate(start))}–${displayDate(isoDate(end))}`;
  } else if (period === "month") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    title = `Месяц ${String(anchor.getUTCMonth() + 1).padStart(2, "0")}.${anchor.getUTCFullYear()}`;
  } else if (period === "quarter") {
    const quarter = Math.floor(anchor.getUTCMonth() / 3);
    start = new Date(Date.UTC(anchor.getUTCFullYear(), quarter * 3, 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), quarter * 3 + 3, 0));
    title = `${quarter + 1}-й квартал ${anchor.getUTCFullYear()}`;
  } else {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31));
    title = `Год ${anchor.getUTCFullYear()}`;
  }

  return { start: isoDate(start), end: isoDate(end), title };
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || "—";
}

function transactionPath(transaction: Transaction, rootFolder: string): string {
  const [year, month] = transaction.effectiveDate.split("-");
  const root = rootFolder.trim().replace(/^\/+|\/+$/g, "");
  return [root, "Transactions", year, month, transaction.id].filter(Boolean).join("/");
}

function visibleAmount(transaction: Transaction): bigint {
  const external = transaction.postings.find((posting) => posting.accountId === "external")?.minorUnits;
  if (external !== undefined) return external < 0n ? -external : external;
  const outgoing = transaction.postings.find((posting) => posting.minorUnits < 0n)?.minorUnits ?? 0n;
  return outgoing < 0n ? -outgoing : outgoing;
}

export function buildArchiveReport(
  period: ReportPeriod,
  anchorDate: string,
  accounts: Account[],
  transactions: Transaction[],
  currency: string,
  locale = "ru-RU",
  generatedAt = new Date(),
  rootFolder = ""
): ArchiveReport {
  const range = getReportRange(period, anchorDate);
  const eligible = transactions
    .filter((transaction) => transaction.currency === currency && transaction.effectiveDate >= range.start && transaction.effectiveDate <= range.end)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt));
  const internal = accounts.filter((account) => account.kind === "asset").sort((a, b) => a.order - b.order);
  const names = new Map(accounts.map((account) => [account.id, account.name]));

  let incoming = 0n;
  let outgoing = 0n;
  for (const transaction of eligible) {
    const external = transaction.postings.find((posting) => posting.accountId === "external")?.minorUnits ?? 0n;
    if (external < 0n) incoming += -external;
    if (external > 0n) outgoing += external;
  }

  const money = (value: bigint): string => formatMoney(value, currency, locale);
  const accountRows = internal.map((account) => {
    let opening = 0n;
    let debit = 0n;
    let credit = 0n;
    for (const transaction of transactions.filter((item) => item.currency === currency)) {
      const amount = transaction.postings.filter((posting) => posting.accountId === account.id).reduce((sum, posting) => sum + posting.minorUnits, 0n);
      if (transaction.effectiveDate < range.start) opening += amount;
      else if (transaction.effectiveDate <= range.end) {
        if (amount > 0n) debit += amount;
        if (amount < 0n) credit += -amount;
      }
    }
    return `| ${escapeCell(account.name)} | ${money(opening)} | ${money(debit)} | ${money(credit)} | ${money(opening + debit - credit)} |`;
  });

  const transactionRows = eligible.map((transaction, index) => {
    const movements = transaction.postings
      .filter((posting) => posting.accountId !== "external")
      .map((posting) => `${names.get(posting.accountId) ?? posting.accountId} ${money(posting.minorUnits)}`)
      .join("; ");
    const description = [transaction.counterparty, transaction.comment].filter(Boolean).join(" — ");
    const receipt = transaction.receiptPath ? `[[${transaction.receiptPath}|Чек]]` : "—";
    return `| ${index + 1} | ${displayDate(transaction.effectiveDate)} | ${transactionLabels[transaction.type]} | ${escapeCell(description)} | ${escapeCell(transaction.categoryId ?? "")} | ${escapeCell(movements)} | ${money(visibleAmount(transaction))} | ${receipt} | [[${transactionPath(transaction, rootFolder)}|Открыть]] |`;
  });

  const generated = generatedAt.toISOString();
  const content = [
    "---",
    'schema: "buchhaltzar.report.v1"',
    `period: "${period}"`,
    `periodStart: "${range.start}"`,
    `periodEnd: "${range.end}"`,
    `generatedAt: "${generated}"`,
    `currency: "${currency}"`,
    `transactionCount: ${eligible.length}`,
    "---",
    "",
    `# Архивный отчёт · ${range.title}`,
    "",
    `> Период: **${displayDate(range.start)}–${displayDate(range.end)}** · Сформирован: ${generated.slice(0, 10)}`,
    "",
    "## Итоги",
    "",
    "| Показатель | Значение |",
    "| --- | ---: |",
    `| Поступления | ${money(incoming)} |`,
    `| Списания | ${money(outgoing)} |`,
    `| Чистое изменение | ${money(incoming - outgoing)} |`,
    `| Количество транзакций | ${eligible.length} |`,
    "",
    "## Движение по счетам",
    "",
    "| Счёт | На начало | Поступило | Списано | На конец |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...accountRows,
    "",
    "## Расшифровка транзакций",
    "",
    "| № | Дата | Тип | Контрагент / комментарий | Категория | Движение по счетам | Сумма | Документ | Операция |",
    "| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |",
    ...(transactionRows.length ? transactionRows : ["| — | — | — | За выбранный период транзакций нет | — | — | — | — | — |"]),
    ""
  ].join("\n");

  return {
    filename: `report-${period}-${range.start}--${range.end}.md`,
    content,
    range,
    transactionCount: eligible.length
  };
}
