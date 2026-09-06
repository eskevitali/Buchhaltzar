import type { TransactionType } from "../core/types";

export interface AiTransactionDraft {
  type: Exclude<TransactionType, "reversal">;
  amount: string;
  currency: string;
  effectiveDate: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  categoryId?: string;
  counterparty?: string;
  paymentMethod?: string;
  comment?: string;
  sourceText?: string;
  lineItems?: Array<{ name: string; quantity: string; unitPrice?: string; amount: string; ocrEvidence?: string }>;
}

export interface AiProvider {
  transcribe(audio: Blob): Promise<string>;
  interpretText(text: string, currency: string): Promise<AiTransactionDraft>;
  recognizeReceipt(imageDataUrls: string[], currency: string): Promise<AiTransactionDraft>;
  testConnection(): Promise<void>;
}

export interface AiSettings {
  enabled: boolean;
  provider: "openai";
  baseUrl: string;
  textVisionModel: string;
  transcriptionModel: string;
  rememberApiKey: boolean;
  apiKey?: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  textVisionModel: "gpt-4o-mini",
  transcriptionModel: "gpt-transcribe",
  rememberApiKey: false
};
