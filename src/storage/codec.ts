import { parseYaml } from "obsidian";
import { parseMedium, type Account, type Posting, type ReceiptItem, type Transaction, type TransactionType } from "../core/types";

function q(value: string): string { return JSON.stringify(value); }
function frontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) throw new Error("Нет YAML frontmatter");
  return match[1];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ожидался объект YAML");
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Некорректное поле ${field}`);
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

export function serializeAccount(account: Account): string {
  return `---\nschema: ${q(account.schema)}\nid: ${q(account.id)}\nname: ${q(account.name)}\nkind: ${q(account.kind)}\nactive: ${account.active}\nallowNegative: ${account.allowNegative}\norder: ${account.order}\n---\n\n# ${account.name}\n`;
}

export function parseAccount(content: string): Account {
  const data = object(parseYaml(frontmatter(content)));
  if (data.schema !== "buchhaltzar.account.v1") throw new Error("Неизвестная схема счёта");
  const kind = string(data.kind, "kind");
  if (kind !== "asset" && kind !== "external") throw new Error("Некорректный вид счёта");
  return {
    schema: "buchhaltzar.account.v1", id: string(data.id, "id"), name: string(data.name, "name"), kind,
    active: data.active === true, allowNegative: data.allowNegative === true,
    order: typeof data.order === "number" ? data.order : 0
  };
}

export function serializeTransaction(transaction: Transaction): string {
  const optional: Array<[string, string | undefined]> = [
    ["paymentMethod", transaction.paymentMethod], ["categoryId", transaction.categoryId],
    ["counterparty", transaction.counterparty], ["comment", transaction.comment],
    ["receiptPath", transaction.receiptPath], ["reverses", transaction.reverses]
  ];
  const lines = [
    "---", `schema: ${q(transaction.schema)}`, `id: ${q(transaction.id)}`,
    `idempotencyKey: ${q(transaction.idempotencyKey)}`, `createdAt: ${q(transaction.createdAt)}`,
    `effectiveDate: ${q(transaction.effectiveDate)}`, `type: ${q(transaction.type)}`,
    `status: ${q(transaction.status)}`, `currency: ${q(transaction.currency)}`,
    ...optional.filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${q(value!)}`),
    ...(transaction.receiptItems?.length ? ["receiptItems:", ...transaction.receiptItems.flatMap((item) => [
      `  - name: ${q(item.name)}`,
      ...(item.quantity ? [`    quantity: ${q(item.quantity)}`] : []),
      ...(item.unitPriceMinorUnits !== undefined ? [`    unitPriceMinorUnits: ${q(item.unitPriceMinorUnits.toString())}`] : []),
      `    minorUnits: ${q(item.minorUnits.toString())}`, `    accountId: ${q(item.accountId)}`
    ])] : []),
    "postings:", ...transaction.postings.flatMap((posting) => [
      `  - accountId: ${q(posting.accountId)}`,
      `    minorUnits: ${q(posting.minorUnits.toString())}`,
      ...(posting.medium ? [`    medium: ${q(posting.medium)}`] : [])
    ]), "---", "", `# ${transactionTitle(transaction)}`, "",
    transaction.comment || "Операция Buchhaltzar.", ""
  ];
  return lines.join("\n");
}

export function parseTransaction(content: string): Transaction {
  const data = object(parseYaml(frontmatter(content)));
  if (data.schema !== "buchhaltzar.transaction.v1") throw new Error("Неизвестная схема транзакции");
  const postingsRaw = data.postings;
  if (!Array.isArray(postingsRaw)) throw new Error("Некорректные проводки");
  const postings: Posting[] = postingsRaw.map((raw) => {
    const posting = object(raw);
    const minor = string(posting.minorUnits, "minorUnits");
    if (!/^-?\d+$/.test(minor)) throw new Error("minorUnits должен быть целым числом");
    const accountId = string(posting.accountId, "accountId");
    const medium = parseMedium(posting.medium) ?? (accountId === "cash" ? "cash" : accountId === "external" ? undefined : "cashless");
    return { accountId, minorUnits: BigInt(minor), ...(medium ? { medium } : {}) };
  });
  const receiptItems: ReceiptItem[] | undefined = Array.isArray(data.receiptItems) ? data.receiptItems.map((raw) => {
    const item = object(raw); const minor = string(item.minorUnits, "receiptItems.minorUnits");
    if (!/^-?\d+$/.test(minor)) throw new Error("Сумма позиции чека должна быть целым числом");
    const unitPrice = optionalString(item.unitPriceMinorUnits);
    if (unitPrice && !/^-?\d+$/.test(unitPrice)) throw new Error("Цена единицы должна быть целым числом");
    return { name: string(item.name, "receiptItems.name"), quantity: optionalString(item.quantity), unitPriceMinorUnits: unitPrice ? BigInt(unitPrice) : undefined, minorUnits: BigInt(minor), accountId: string(item.accountId, "receiptItems.accountId") };
  }) : undefined;
  const type = string(data.type, "type") as TransactionType;
  if (!["income", "main-income", "expense", "transfer", "reversal"].includes(type)) throw new Error("Неизвестный тип операции");
  if (data.status !== "posted") throw new Error("Поддерживаются только проведённые операции");
  return {
    schema: "buchhaltzar.transaction.v1", id: string(data.id, "id"),
    idempotencyKey: string(data.idempotencyKey, "idempotencyKey"), createdAt: string(data.createdAt, "createdAt"),
    effectiveDate: string(data.effectiveDate, "effectiveDate"), type, status: "posted",
    currency: string(data.currency, "currency"), paymentMethod: optionalString(data.paymentMethod),
    categoryId: optionalString(data.categoryId), counterparty: optionalString(data.counterparty),
    comment: optionalString(data.comment), receiptPath: optionalString(data.receiptPath), receiptItems, reverses: optionalString(data.reverses), postings
  };
}

export function transactionTitle(transaction: Transaction): string {
  const names: Record<TransactionType, string> = {
    income: "Приход", "main-income": "Основной приход", expense: "Расход", transfer: "Перевод", reversal: "Сторно"
  };
  return `${names[transaction.type]}${transaction.comment ? `: ${transaction.comment}` : ""}`;
}
