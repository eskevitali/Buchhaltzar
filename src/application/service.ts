import { calculateBalances, buildTransaction, reverseTransaction } from "../core/ledger";
import type { Transaction, TransactionInput } from "../core/types";
import type { ObsidianRepository, RepositorySnapshot } from "../storage/obsidian-repository";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "../ai/types";
import { buildArchiveReport, type ArchiveReport, type ReportPeriod } from "../core/report";

export interface BuchhaltzarSettings {
  rootFolder: string;
  baseCurrency: string;
  locale: string;
  negativeBalance: "warn" | "block";
  ai: AiSettings;
}

export const DEFAULT_SETTINGS: BuchhaltzarSettings = {
  rootFolder: "",
  baseCurrency: "EUR",
  locale: "ru-RU",
  negativeBalance: "warn",
  ai: DEFAULT_AI_SETTINGS
};

export interface TransactionPreview {
  transaction: Transaction;
  insufficientAccounts: string[];
}
export interface ReceiptAttachment { data: ArrayBuffer; extension: string; }
export interface SavedArchiveReport extends ArchiveReport { path: string; }

export class BuchhaltzarService {
  constructor(private readonly repository: ObsidianRepository, readonly settings: BuchhaltzarSettings) {}

  initialize(): Promise<void> { return this.repository.initialize(); }
  installBundledContent(): Promise<void> { return this.repository.installBundledContent(); }
  snapshot(): Promise<RepositorySnapshot> { return this.repository.snapshot(); }

  async preview(input: TransactionInput): Promise<TransactionPreview> {
    const transaction = buildTransaction(input);
    const snapshot = await this.repository.snapshot();
    const balances = calculateBalances(snapshot.accounts, snapshot.transactions, input.currency);
    const insufficientAccounts = transaction.postings.filter((posting) => posting.minorUnits < 0n && posting.accountId !== "external" && (balances.get(posting.accountId) ?? 0n) + posting.minorUnits < 0n).map((posting) => posting.accountId);
    if (insufficientAccounts.length && this.settings.negativeBalance === "block") throw new Error("Недостаточно средств на одном или нескольких счетах");
    return { transaction, insufficientAccounts };
  }

  async confirm(transaction: Transaction, receipt?: ReceiptAttachment): Promise<unknown> {
    let posted = transaction;
    if (receipt) posted = { ...transaction, receiptPath: await this.repository.saveReceipt(transaction, receipt.data, receipt.extension) };
    return this.repository.createTransaction(posted);
  }

  async reverse(id: string): Promise<void> {
    const snapshot = await this.repository.snapshot();
    const original = snapshot.transactions.find((transaction) => transaction.id === id);
    if (!original) throw new Error("Исходная операция не найдена");
    if (original.type === "reversal") throw new Error("Нельзя сторнировать сторно");
    if (snapshot.transactions.some((transaction) => transaction.reverses === id)) throw new Error("Операция уже сторнирована");
    await this.repository.createTransaction(reverseTransaction(original));
  }

  async createArchiveReport(period: ReportPeriod, anchorDate: string): Promise<SavedArchiveReport> {
    const snapshot = await this.repository.snapshot();
    const report = buildArchiveReport(period, anchorDate, snapshot.accounts, snapshot.transactions, this.settings.baseCurrency, this.settings.locale, new Date(), this.settings.rootFolder);
    const path = await this.repository.saveReport(report.filename, report.content);
    return { ...report, path };
  }
}
