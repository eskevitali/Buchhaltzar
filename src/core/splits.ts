import type { ReceiptItem } from "./types";

export interface ExpenseSplitInput { minorUnits: bigint; accountId: string }

export function buildExpenseSplitItems(total: bigint, primaryAccountId: string, parts: ExpenseSplitInput[]): ReceiptItem[] | undefined {
  if (!parts.length) return undefined;
  if (parts.some((part) => part.minorUnits <= 0n)) throw new Error("Каждая выделенная сумма должна быть больше нуля");
  const allocated = parts.reduce((sum, part) => sum + part.minorUnits, 0n);
  if (allocated > total) throw new Error("Распределённая сумма превышает сумму расхода");
  const items: ReceiptItem[] = parts.map((part, index) => ({ name: `Часть расхода ${index + 1}`, minorUnits: part.minorUnits, accountId: part.accountId }));
  const remainder = total - allocated;
  if (remainder > 0n) items.push({ name: "Остаток расхода", minorUnits: remainder, accountId: primaryAccountId });
  return items;
}
