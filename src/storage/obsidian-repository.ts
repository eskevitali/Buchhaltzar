import { normalizePath, TFile, Vault } from "obsidian";
import { validatePostings } from "../core/ledger";
import { DEFAULT_ACCOUNTS, type Account, type Transaction } from "../core/types";
import { parseAccount, parseTransaction, serializeAccount, serializeTransaction } from "./codec";
import { createVaultFileIfAbsent, ensureVaultFolder } from "./vault-write";
import royalAccountingNote from "../content/Почему учёт называется царским.md";
import gravitonAnnotation from "../content/GraviTON — краткая аннотация.md";
import welcomeNote from "../content/Добро пожаловать.md";
import gravitonKonArchitecture from "../content/GraviTON_ КОН и архитектура хозяйственной системы.md";

export interface RepositorySnapshot {
  accounts: Account[];
  transactions: Transaction[];
  diagnostics: string[];
}

function safeRoot(value: string): string {
  if (!value.trim()) return "";
  const normalized = normalizePath(value.trim()).replace(/^\/+|\/+$/g, "");
  if (normalized === "." || normalized.includes("..")) throw new Error("Некорректный корневой каталог");
  return normalized;
}

export class ObsidianRepository {
  constructor(private readonly vault: Vault, private readonly rootFolder: string) {}

  private path(...parts: string[]): string {
    const root = safeRoot(this.rootFolder);
    return normalizePath([root, ...parts].filter(Boolean).join("/"));
  }

  private ensureFolder(path: string): Promise<void> {
    return ensureVaultFolder(this.vault, normalizePath(path));
  }

  async initialize(): Promise<void> {
    for (const folder of ["Accounts", "Transactions", "Receipts", "Reports", "Templates", "Notes", "Settings"]) {
      await this.ensureFolder(this.path(folder));
    }
    for (const account of DEFAULT_ACCOUNTS) {
      await createVaultFileIfAbsent(this.vault, this.path("Accounts", `${account.id}.md`), serializeAccount(account));
    }
    await createVaultFileIfAbsent(this.vault, this.path("Settings", "schema.md"), "---\nschema: buchhaltzar.settings.v1\nversion: 1\n---\n\n# Схема Buchhaltzar\n");
    await this.installBundledContent();
  }

  async installBundledContent(): Promise<void> {
    await this.ensureFolder(this.path("Notes"));
    const files = [
      { path: this.path("Notes", "Почему учёт называется царским.md"), content: royalAccountingNote },
      { path: this.path("Notes", "GraviTON — краткая аннотация.md"), content: gravitonAnnotation },
      { path: this.path("Notes", "GraviTON_ КОН и архитектура хозяйственной системы.md"), content: gravitonKonArchitecture },
      { path: this.path("Добро пожаловать.md"), content: welcomeNote }
    ];
    for (const file of files) await createVaultFileIfAbsent(this.vault, file.path, file.content);
  }

  async createTransaction(transaction: Transaction): Promise<TFile> {
    validatePostings(transaction.postings);
    const [year, month] = transaction.effectiveDate.split("-");
    if (!/^\d{4}$/.test(year ?? "") || !/^\d{2}$/.test(month ?? "")) throw new Error("Некорректная дата операции");
    const folder = this.path("Transactions", year!, month!);
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${transaction.id}.md`);
    if (this.vault.getAbstractFileByPath(path)) throw new Error("Операция с таким ID уже существует");
    const duplicate = (await this.snapshot()).transactions.find((item) => item.idempotencyKey === transaction.idempotencyKey);
    if (duplicate) throw new Error("Эта операция уже была сохранена");
    return this.vault.create(path, serializeTransaction(transaction));
  }

  async saveReceipt(transaction: Transaction, data: ArrayBuffer, extension: string): Promise<string> {
    const [year, month] = transaction.effectiveDate.split("-");
    if (!/^\d{4}$/.test(year ?? "") || !/^\d{2}$/.test(month ?? "")) throw new Error("Некорректная дата чека");
    const safeExtension = /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase().replace("jpeg", "jpg") : "bin";
    const folder = this.path("Receipts", year!, month!); await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/receipt-${transaction.id}.${safeExtension}`);
    if (this.vault.getAbstractFileByPath(path)) throw new Error("Файл чека уже существует");
    await this.vault.createBinary(path, data); return path;
  }

  async saveReport(filename: string, content: string): Promise<string> {
    if (!/^report-(week|month|quarter|year)-\d{4}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}\.md$/.test(filename)) {
      throw new Error("Некорректное имя отчёта");
    }
    const folder = this.path("Reports");
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${filename}`);
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.vault.modify(existing, content);
    else if (existing) throw new Error("Путь отчёта занят каталогом");
    else await this.vault.create(path, content);
    return path;
  }

  async findTransaction(id: string): Promise<Transaction | null> {
    return (await this.snapshot()).transactions.find((transaction) => transaction.id === id) ?? null;
  }

  async snapshot(): Promise<RepositorySnapshot> {
    const accounts: Account[] = [];
    const transactions: Transaction[] = [];
    const diagnostics: string[] = [];
    const accountPrefix = `${this.path("Accounts")}/`;
    const transactionPrefix = `${this.path("Transactions")}/`;
    for (const file of this.vault.getMarkdownFiles()) {
      try {
        if (file.path.startsWith(accountPrefix)) accounts.push(parseAccount(await this.vault.cachedRead(file)));
        else if (file.path.startsWith(transactionPrefix)) {
          const transaction = parseTransaction(await this.vault.cachedRead(file));
          validatePostings(transaction.postings);
          transactions.push(transaction);
        }
      } catch (error) {
        diagnostics.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    accounts.sort((a, b) => a.order - b.order);
    transactions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { accounts, transactions, diagnostics };
  }
}
