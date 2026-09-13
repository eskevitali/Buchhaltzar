import { splitEvenly } from "./money";
import { PURPOSE_ACCOUNT_IDS, mediumFromPaymentMethod, postingMedium, type Account, type Medium, type Posting, type Transaction, type TransactionInput } from "./types";

const MAIN_ACCOUNTS = [...PURPOSE_ACCOUNT_IDS];

export interface MediumBalance { cash: bigint; cashless: bigint }

function resolveMedium(input: TransactionInput): Medium {
  return input.medium ?? mediumFromPaymentMethod(input.paymentMethod);
}

function assetPosting(accountId: string, minorUnits: bigint, medium: Medium): Posting {
  return { accountId, minorUnits, medium };
}

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
  const medium = resolveMedium(input);
  let postings: Posting[];
  if (input.type === "income") {
    if (!input.accountId || input.accountId === external || input.accountId === "cash") throw new Error("Выберите внутренний счёт");
    postings = [{ accountId: external, minorUnits: -input.amount }, assetPosting(input.accountId, input.amount, medium)];
  } else if (input.type === "main-income") {
    const shares = splitEvenly(input.amount, MAIN_ACCOUNTS.length);
    postings = [{ accountId: external, minorUnits: -input.amount }, ...MAIN_ACCOUNTS.map((accountId, index) => assetPosting(accountId, shares[index] ?? 0n, medium))];
  } else if (input.type === "expense") {
    if (input.receiptItems?.length) {
      const itemTotal = input.receiptItems.reduce((sum, item) => sum + item.minorUnits, 0n);
      if (itemTotal !== input.amount) throw new Error("Сумма позиций чека не совпадает с итогом");
      if (input.receiptItems.some((item) => !item.name.trim() || item.accountId === external || item.accountId === "cash" || item.minorUnits === 0n)) throw new Error("Проверьте позиции и счета чека");
      const grouped = new Map<string, bigint>();
      for (const item of input.receiptItems) grouped.set(item.accountId, (grouped.get(item.accountId) ?? 0n) + item.minorUnits);
      postings = [...grouped.entries()].filter(([, amount]) => amount !== 0n).map(([accountId, amount]) => assetPosting(accountId, -amount, medium));
      postings.push({ accountId: external, minorUnits: input.amount });
    } else {
      if (!input.accountId || input.accountId === external || input.accountId === "cash") throw new Error("Выберите счёт списания");
      postings = [assetPosting(input.accountId, -input.amount, medium), { accountId: external, minorUnits: input.amount }];
    }
  } else {
    if (!input.fromAccountId || !input.toAccountId) throw new Error("Выберите оба счёта");
    if (input.fromAccountId === "cash" || input.toAccountId === "cash") throw new Error("Касса не является счётом перевода");
    if (input.fromAccountId === input.toAccountId) throw new Error("Счета перевода должны различаться");
    postings = [assetPosting(input.fromAccountId, -input.amount, medium), assetPosting(input.toAccountId, input.amount, medium)];
  }
  validatePostings(postings);
  return {
    schema: "buchhaltzar.transaction.v1",
    id: createId("tx"), idempotencyKey: createId("ui"), createdAt: now.toISOString(),
    effectiveDate: input.effectiveDate, type: input.type, status: "posted", currency: input.currency.toUpperCase(),
    paymentMethod: input.paymentMethod ?? medium, categoryId: input.categoryId, counterparty: input.counterparty,
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

export function calculateMediumBalances(accounts: Account[], transactions: Transaction[], currency?: string): Map<string, MediumBalance> {
  const balances = new Map(accounts.map((account) => [account.id, { cash: 0n, cashless: 0n }]));
  for (const transaction of transactions) {
    if (transaction.status !== "posted") continue;
    if (currency && transaction.currency !== currency) continue;
    for (const posting of transaction.postings) {
      const medium = postingMedium(posting);
      if (!medium) continue;
      const current = balances.get(posting.accountId) ?? { cash: 0n, cashless: 0n };
      current[medium] += posting.minorUnits;
      balances.set(posting.accountId, current);
    }
  }
  return balances;
}

export function cashTotal(mediumBalances: Map<string, MediumBalance>): bigint {
  let total = 0n;
  for (const [accountId, balance] of mediumBalances) {
    if (accountId === "external") continue;
    total += balance.cash;
  }
  return total;
}

export function buildOpeningTransaction(mediumBalances: Map<string, MediumBalance>, currency: string, effectiveDate: string, now = new Date()): Transaction | null {
  const postings: Posting[] = [];
  let total = 0n;
  for (const accountId of PURPOSE_ACCOUNT_IDS) {
    const balance = mediumBalances.get(accountId) ?? { cash: 0n, cashless: 0n };
    if (balance.cashless !== 0n) {
      postings.push(assetPosting(accountId, balance.cashless, "cashless"));
      total += balance.cashless;
    }
    if (balance.cash !== 0n) {
      postings.push(assetPosting(accountId, balance.cash, "cash"));
      total += balance.cash;
    }
  }
  if (!postings.length) return null;
  postings.push({ accountId: "external", minorUnits: -total });
  validatePostings(postings);
  return {
    schema: "buchhaltzar.transaction.v1",
    id: createId("tx"), idempotencyKey: createId("ui"), createdAt: now.toISOString(),
    effectiveDate, type: "opening", status: "posted", currency: currency.toUpperCase(),
    comment: `Входящие остатки на ${effectiveDate.split("-").reverse().join(".")}`,
    postings
  };
}
