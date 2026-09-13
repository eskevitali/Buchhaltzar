import { describe, expect, it } from "vitest";
import { buildTransaction, calculateBalances, calculateMediumBalances, cashTotal, reverseTransaction, validatePostings } from "../src/core/ledger";
import { formatMoney, parseAmount, splitEvenly } from "../src/core/money";
import { DEFAULT_ACCOUNTS } from "../src/core/types";
import { normalizeAiDraft } from "../src/ai/normalize";
import { buildExpenseSplitItems } from "../src/core/splits";
import { buildArchiveReport, getReportRange } from "../src/core/report";

describe("money", () => {
  it("parses decimal amounts without floating point", () => {
    expect(parseAmount("24,50", "EUR")).toBe(2450n);
    expect(formatMoney(2450n, "EUR", "de-DE")).toContain("24,50");
  });
  it("distributes every minor unit deterministically", () => {
    const shares = splitEvenly(1003n, 5);
    expect(shares).toEqual([201n, 201n, 201n, 200n, 200n]);
    expect(shares.reduce((sum, item) => sum + item, 0n)).toBe(1003n);
  });
});

describe("AI draft boundary", () => {
  it("accepts a structured receipt draft", () => {
    const draft = normalizeAiDraft({ type: "expense", amount: "24.50", currency: "EUR", effectiveDate: "2026-09-06", accountId: "urgent", fromAccountId: null, toAccountId: null, categoryId: "food", counterparty: "Market", paymentMethod: "card", comment: "Продукты", lineItems: [{ name: "Хлеб", amount: "2.50" }, { name: "Подарок", amount: "22.00" }] });
    expect(draft.amount).toBe("24.50"); expect(draft.accountId).toBe("urgent"); expect(draft.paymentMethod).toBe("card"); expect(draft.lineItems).toHaveLength(2);
  });
  it("rejects incomplete AI output", () => {
    expect(() => normalizeAiDraft({ type: "expense", amount: "12" })).toThrow("сумму, валюту или дату");
  });
  it("routes grocery receipts to urgent deterministically", () => {
    const draft = normalizeAiDraft({ type: "expense", amount: "62.69", currency: "EUR", effectiveDate: "2026-09-06", accountId: "business", counterparty: "HOFER KG", comment: "Grocery shopping" });
    expect(draft.accountId).toBe("urgent"); expect(draft.categoryId).toBe("groceries");
  });
});

describe("ledger", () => {
  it("builds a balanced main income", () => {
    const transaction = buildTransaction({ type: "main-income", amount: 1003n, currency: "EUR", effectiveDate: "2026-09-06" });
    expect(transaction.postings).toHaveLength(6);
    expect(() => validatePostings(transaction.postings)).not.toThrow();
  });
  it("builds income, expense and transfer", () => {
    for (const input of [
      { type: "income" as const, amount: 100n, currency: "EUR", effectiveDate: "2026-09-06", accountId: "business" },
      { type: "expense" as const, amount: 25n, currency: "EUR", effectiveDate: "2026-09-06", accountId: "urgent" },
      { type: "transfer" as const, amount: 40n, currency: "EUR", effectiveDate: "2026-09-06", fromAccountId: "urgent", toAccountId: "business" }
    ]) expect(() => validatePostings(buildTransaction(input).postings)).not.toThrow();
  });
  it("reversal restores all balances", () => {
    const income = buildTransaction({ type: "income", amount: 500n, currency: "EUR", effectiveDate: "2026-09-06", accountId: "business" });
    const reversal = reverseTransaction(income);
    const balances = calculateBalances(DEFAULT_ACCOUNTS, [income, reversal]);
    expect([...balances.values()].every((value) => value === 0n)).toBe(true);
    expect(reversal.reverses).toBe(income.id);
  });
  it("rejects an unbalanced operation", () => {
    expect(() => validatePostings([{ accountId: "a", minorUnits: 1n }, { accountId: "b", minorUnits: -2n }])).toThrow("не сбалансированы");
  });
  it("splits one receipt across several expense accounts", () => {
    const transaction = buildTransaction({
      type: "expense", amount: 1000n, currency: "EUR", effectiveDate: "2026-09-06", accountId: "urgent",
      receiptItems: [
        { name: "Продукты", minorUnits: 400n, accountId: "urgent" },
        { name: "Подарок", minorUnits: 150n, accountId: "fund" },
        { name: "Инструмент", minorUnits: 250n, accountId: "capital" },
        { name: "Книга", minorUnits: 200n, accountId: "future" }
      ]
    });
    expect(transaction.postings).toEqual([
      { accountId: "urgent", minorUnits: -400n, medium: "cashless" }, { accountId: "fund", minorUnits: -150n, medium: "cashless" },
      { accountId: "capital", minorUnits: -250n, medium: "cashless" }, { accountId: "future", minorUnits: -200n, medium: "cashless" },
      { accountId: "external", minorUnits: 1000n }
    ]);
    expect(() => validatePostings(transaction.postings)).not.toThrow();
  });
  it("rejects a receipt whose rows do not match its total", () => {
    expect(() => buildTransaction({ type: "expense", amount: 1000n, currency: "EUR", effectiveDate: "2026-09-06", receiptItems: [{ name: "Товар", minorUnits: 999n, accountId: "urgent" }] })).toThrow("не совпадает");
  });
});

describe("manual expense split", () => {
  it("reduces the remainder and assigns it to the primary account", () => {
    expect(buildExpenseSplitItems(6269n, "urgent", [
      { minorUnits: 1000n, accountId: "fund" }, { minorUnits: 2000n, accountId: "future" }
    ])).toEqual([
      { name: "Часть расхода 1", minorUnits: 1000n, accountId: "fund" },
      { name: "Часть расхода 2", minorUnits: 2000n, accountId: "future" },
      { name: "Остаток расхода", minorUnits: 3269n, accountId: "urgent" }
    ]);
  });
  it("rejects allocation above the expense total", () => {
    expect(() => buildExpenseSplitItems(1000n, "urgent", [{ minorUnits: 1001n, accountId: "fund" }])).toThrow("превышает");
  });
});

describe("archive reports", () => {
  it("calculates calendar ranges from an anchor date", () => {
    expect(getReportRange("week", "2026-09-06")).toMatchObject({ start: "2026-08-31", end: "2026-09-06" });
    expect(getReportRange("month", "2026-09-06")).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
    expect(getReportRange("quarter", "2026-09-06")).toMatchObject({ start: "2026-07-01", end: "2026-09-30" });
    expect(getReportRange("year", "2026-09-06")).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("builds one markdown report with summaries and transaction details", () => {
    const income = buildTransaction({ type: "income", amount: 10000n, currency: "EUR", effectiveDate: "2026-09-01", accountId: "business", counterparty: "Клиент" });
    const expense = buildTransaction({ type: "expense", amount: 6269n, currency: "EUR", effectiveDate: "2026-09-06", accountId: "urgent", counterparty: "HOFER", categoryId: "groceries" });
    const outside = buildTransaction({ type: "expense", amount: 100n, currency: "EUR", effectiveDate: "2026-10-01", accountId: "urgent" });
    const report = buildArchiveReport("month", "2026-09-06", DEFAULT_ACCOUNTS, [outside, expense, income], "EUR", "ru-RU", new Date("2026-09-06T12:00:00Z"));
    expect(report.filename).toBe("report-month-2026-09-01--2026-09-30.md");
    expect(report.transactionCount).toBe(2);
    expect(report.content).toContain("| Поступления | 100,00 € |");
    expect(report.content).toContain("| Списания | 62,69 € |");
    expect(report.content).toContain("## Движение по счетам");
    expect(report.content).toContain("## Расшифровка транзакций");
    expect(report.content).toContain(`[[Transactions/2026/09/${expense.id}|Открыть]]`);
    expect(report.content).not.toContain("01.10.2026");
  });
});

describe("cash and cashless media", () => {
  it("posts income onto the chosen medium without mixing forms", () => {
    const cash = buildTransaction({ type: "income", amount: 5000n, currency: "EUR", effectiveDate: "2026-09-13", accountId: "urgent", medium: "cash" });
    const bank = buildTransaction({ type: "income", amount: 7000n, currency: "EUR", effectiveDate: "2026-09-13", accountId: "urgent", medium: "cashless" });
    const media = calculateMediumBalances(DEFAULT_ACCOUNTS, [cash, bank], "EUR");
    const urgent = media.get("urgent");
    expect(urgent).toEqual({ cash: 5000n, cashless: 7000n });
    expect(calculateBalances(DEFAULT_ACCOUNTS, [cash, bank], "EUR").get("urgent")).toBe(12000n);
    expect(cashTotal(media)).toBe(5000n);
  });

  it("splits main income across purpose accounts in the same medium", () => {
    const transaction = buildTransaction({ type: "main-income", amount: 1000n, currency: "EUR", effectiveDate: "2026-09-13", medium: "cash" });
    expect(transaction.postings.filter((posting) => posting.accountId !== "external").every((posting) => posting.medium === "cash")).toBe(true);
    expect(cashTotal(calculateMediumBalances(DEFAULT_ACCOUNTS, [transaction], "EUR"))).toBe(1000n);
  });

  it("does not spend cash when only cashless remains on the account", () => {
    const bank = buildTransaction({ type: "income", amount: 10000n, currency: "EUR", effectiveDate: "2026-09-13", accountId: "urgent", medium: "cashless" });
    const spendCash = buildTransaction({ type: "expense", amount: 1000n, currency: "EUR", effectiveDate: "2026-09-13", accountId: "urgent", medium: "cash" });
    const media = calculateMediumBalances(DEFAULT_ACCOUNTS, [bank, spendCash], "EUR");
    expect(media.get("urgent")).toEqual({ cash: -1000n, cashless: 10000n });
  });
});
