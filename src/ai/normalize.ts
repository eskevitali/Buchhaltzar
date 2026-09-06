import type { AiTransactionDraft } from "./types";

export function normalizeAiDraft(raw: unknown, sourceText?: string): AiTransactionDraft {
  if (!raw || typeof raw !== "object") throw new Error("ИИ вернул некорректный черновик");
  const data = raw as Record<string, unknown>;
  const type = data.type;
  if (!["income", "main-income", "expense", "transfer"].includes(String(type))) throw new Error("ИИ не определил тип операции");
  const value = (key: string): string | undefined => typeof data[key] === "string" && data[key] ? String(data[key]) : undefined;
  const amount = value("amount"); const currency = value("currency"); const effectiveDate = value("effectiveDate");
  if (!amount || !currency || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate ?? "")) throw new Error("ИИ не определил сумму, валюту или дату");
  let accountId = value("accountId"); let categoryId = value("categoryId");
  const context = [categoryId, value("counterparty"), value("comment")].filter(Boolean).join(" ").toLowerCase();
  if (type === "expense" && /grocer|food|supermarket|lebensmittel|продукт/.test(context)) {
    accountId = "urgent"; categoryId ||= "groceries";
  }
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>; const name = typeof item.name === "string" ? item.name.trim() : ""; const itemAmount = typeof item.amount === "string" ? item.amount.trim() : "";
    const quantity = typeof item.quantity === "string" && item.quantity.trim() ? item.quantity.trim() : "1";
    const unitPrice = typeof item.unitPrice === "string" && item.unitPrice.trim() ? item.unitPrice.trim() : undefined;
    const ocrEvidence = typeof item.ocrEvidence === "string" ? item.ocrEvidence : undefined;
    return name && /^-?\d+(?:[.,]\d+)?$/.test(itemAmount) ? [{ name, quantity, unitPrice, amount: itemAmount, ocrEvidence }] : [];
  }) : [];
  return { type: type as AiTransactionDraft["type"], amount, currency, effectiveDate: effectiveDate!, accountId, fromAccountId: value("fromAccountId"), toAccountId: value("toAccountId"), categoryId, counterparty: value("counterparty"), paymentMethod: value("paymentMethod"), comment: value("comment"), sourceText, lineItems };
}
