export const ACCOUNT_IDS = ["urgent", "business", "fund", "capital", "future", "cash", "external"] as const;
export type SystemAccountId = (typeof ACCOUNT_IDS)[number];
export type TransactionType = "income" | "main-income" | "expense" | "transfer" | "reversal";

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
