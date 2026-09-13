export const ACCOUNT_IDS = ["urgent", "business", "fund", "capital", "future", "cash", "external"] as const;
export const PURPOSE_ACCOUNT_IDS = ["urgent", "business", "fund", "capital", "future"] as const;
export const MEDIA = ["cash", "cashless"] as const;
export type SystemAccountId = (typeof ACCOUNT_IDS)[number];
export type PurposeAccountId = (typeof PURPOSE_ACCOUNT_IDS)[number];
export type Medium = (typeof MEDIA)[number];
export type TransactionType = "income" | "main-income" | "expense" | "transfer" | "reversal";

export function isPurposeAccount(id: string): boolean {
  return (PURPOSE_ACCOUNT_IDS as readonly string[]).includes(id);
}

export function parseMedium(value: unknown): Medium | undefined {
  return value === "cash" || value === "cashless" ? value : undefined;
}

export function mediumFromPaymentMethod(value: string | undefined): Medium {
  return value === "cash" ? "cash" : "cashless";
}

export function postingMedium(posting: Posting): Medium | undefined {
  if (posting.accountId === "external") return undefined;
  if (posting.accountId === "cash") return "cash";
  return posting.medium ?? "cashless";
}

export interface Account {
  schema: "buchhaltzar.account.v1";
  id: string;
  name: string;
  kind: "asset" | "external";
  active: boolean;
  allowNegative: boolean;
  order: number;
}

export interface Posting {
  accountId: string;
  minorUnits: bigint;
  medium?: Medium;
}

export interface ReceiptItem {
  name: string;
  quantity?: string;
  unitPriceMinorUnits?: bigint;
  minorUnits: bigint;
  accountId: string;
}

export interface Transaction {
  schema: "buchhaltzar.transaction.v1";
  id: string;
  idempotencyKey: string;
  createdAt: string;
  effectiveDate: string;
  type: TransactionType;
  status: "posted";
  currency: string;
  paymentMethod?: string;
  categoryId?: string;
  counterparty?: string;
  comment?: string;
  receiptPath?: string;
  receiptItems?: ReceiptItem[];
  reverses?: string;
  postings: Posting[];
}

export interface TransactionInput {
  type: Exclude<TransactionType, "reversal">;
  amount: bigint;
  currency: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  effectiveDate: string;
  medium?: Medium;
  paymentMethod?: string;
  categoryId?: string;
  counterparty?: string;
  comment?: string;
  receiptItems?: ReceiptItem[];
}

export const DEFAULT_ACCOUNTS: Account[] = [
  { schema: "buchhaltzar.account.v1", id: "urgent", name: "Срочные", kind: "asset", active: true, allowNegative: false, order: 10 },
  { schema: "buchhaltzar.account.v1", id: "business", name: "Бизнес", kind: "asset", active: true, allowNegative: false, order: 20 },
  { schema: "buchhaltzar.account.v1", id: "fund", name: "Фонд", kind: "asset", active: true, allowNegative: false, order: 30 },
  { schema: "buchhaltzar.account.v1", id: "capital", name: "Капитал", kind: "asset", active: true, allowNegative: false, order: 40 },
  { schema: "buchhaltzar.account.v1", id: "future", name: "Будущее", kind: "asset", active: true, allowNegative: false, order: 50 },
  { schema: "buchhaltzar.account.v1", id: "cash", name: "Касса", kind: "asset", active: true, allowNegative: false, order: 60 },
  { schema: "buchhaltzar.account.v1", id: "external", name: "Внешний мир", kind: "external", active: true, allowNegative: true, order: 999 }
];
