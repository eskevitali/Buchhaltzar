import { splitEvenly } from "./money";
import type { Account, Posting, Transaction, TransactionInput } from "./types";

const MAIN_ACCOUNTS = ["urgent", "business", "fund", "capital", "future"];

export function createId(prefix: "tx" | "ui" = "tx"): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.getRandomValues(new Uint32Array(3));
  return `${prefix}-${time}-${Array.from(random, (part) => part.toString(36).padStart(7, "0")).join("").toUpperCase()}`;
}

export function validatePostings(postings: Posting[]): void {
  if (postings.length < 2) throw new Error("Операция должна содержать минимум две проводки");
  const sum = postings.reduce((total, posting) => total + posting.minorUnits, 0n);
  if (sum !== 0n) throw new Error("Проводки не сбалансированы");
  if (postings.some((posting) => posting.minorUnits === 0n)) throw new Error("Нулевая проводка запрещена");
}

export function buildTransaction(input: TransactionInput, now = new Date()): Transaction {
  if (input.amount <= 0n) throw new Error("Сумма должна быть больше нуля");
  const external = "external";
  let postings: Posting[];
  if (input.type === "income") {
    if (!input.accountId || input.accountId === external) throw new Error("Выберите внутренний счёт");
    postings = [{ accountId: external, minorUnits: -input.amount }, { accountId: input.accountId, minorUnits: input.amount }];
  } else if (input.type === "main-income") {
    const shares = splitEvenly(input.amount, MAIN_ACCOUNTS.length);
    postings = [{ accountId: external, minorUnits: -input.amount }, ...MAIN_ACCOUNTS.map((accountId, index) => ({ accountId, minorUnits: shares[index] ?? 0n }))];
  } else if (input.type === "expense") {
    if (input.receiptItems?.length) {
      const itemTotal = input.receiptItems.reduce((sum, item) => sum + item.minorUnits, 0n);
      if (itemTotal !== input.amount) throw new Error("Сумма позиций чека не совпадает с итогом");
      if (input.receiptItems.some((item) => !item.name.trim() || item.accountId === external || item.minorUnits === 0n)) throw new Error("Проверьте позиции и счета чека");
      const grouped = new Map<string, bigint>();
      for (const item of input.receiptItems) grouped.set(item.accountId, (grouped.get(item.accountId) ?? 0n) + item.minorUnits);
      postings = [...grouped.entries()].filter(([, amount]) => amount !== 0n).map(([accountId, amount]) => ({ accountId, minorUnits: -amount }));
      postings.push({ accountId: external, minorUnits: input.amount });
    } else {
      if (!input.accountId || input.accountId === external) throw new Error("Выберите счёт списания");
      postings = [{ accountId: input.accountId, minorUnits: -input.amount }, { accountId: external, minorUnits: input.amount }];
    }
  } else {
    if (!input.fromAccountId || !input.toAccountId) throw new Error("Выберите оба счёта");
    if (input.fromAccountId === input.toAccountId) throw new Error("Счета перевода должны различаться");
    postings = [{ accountId: input.fromAccountId, minorUnits: -input.amount }, { accountId: input.toAccountId, minorUnits: input.amount }];
  }
  validatePostings(postings);
  return {
    schema: "buchhaltzar.transaction.v1",
    id: createId("tx"), idempotencyKey: createId("ui"), createdAt: now.toISOString(),
    effectiveDate: input.effectiveDate, type: input.type, status: "posted", currency: input.currency.toUpperCase(),
    paymentMethod: input.paymentMethod, categoryId: input.categoryId, counterparty: input.counterparty,
    comment: input.comment?.trim() || undefined, receiptItems: input.receiptItems, postings
  };
}

export function reverseTransaction(original: Transaction, now = new Date()): Transaction {
  const transaction: Transaction = {
    ...original,
    id: createId("tx"), idempotencyKey: createId("ui"), createdAt: now.toISOString(),
    effectiveDate: now.toISOString().slice(0, 10), type: "reversal", reverses: original.id,
    receiptPath: undefined,
    receiptItems: undefined,
    comment: `Сторно ${original.id}${original.comment ? `: ${original.comment}` : ""}`,
    postings: original.postings.map((posting) => ({ ...posting, minorUnits: -posting.minorUnits }))
  };
  validatePostings(transaction.postings);
  return transaction;
}

export function calculateBalances(accounts: Account[], transactions: Transaction[], currency?: string): Map<string, bigint> {
  const balances = new Map(accounts.map((account) => [account.id, 0n]));
  for (const transaction of transactions) {
    if (transaction.status !== "posted") continue;
    if (currency && transaction.currency !== currency) continue;
    for (const posting of transaction.postings) balances.set(posting.accountId, (balances.get(posting.accountId) ?? 0n) + posting.minorUnits);
  }
  return balances;
}
