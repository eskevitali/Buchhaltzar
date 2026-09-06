import { requestUrl } from "obsidian";
import type { AiProvider, AiTransactionDraft, AiSettings } from "./types";
import { normalizeAiDraft } from "./normalize";

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["income", "main-income", "expense", "transfer"] },
    amount: { type: "string", description: "Positive decimal amount without currency symbol" },
    amountEvidence: { type: "string", description: "Exact short receipt fragment that proves the total" },
    currency: { type: "string" },
    effectiveDate: { type: "string", description: "YYYY-MM-DD" },
    dateEvidence: { type: "string", description: "Exact short receipt fragment used for the fiscal date" },
    accountId: { type: ["string", "null"] },
    fromAccountId: { type: ["string", "null"] },
    toAccountId: { type: ["string", "null"] },
    categoryId: { type: ["string", "null"] },
    counterparty: { type: ["string", "null"] },
    paymentMethod: { type: ["string", "null"], enum: ["cash", "card", "transfer", "manual", null] },
    comment: { type: ["string", "null"] },
    lineItems: { type: "array", description: "Every charged receipt row. Empty for non-receipt commands.", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, quantity: { type: "string", description: "Plain decimal number only" }, unitPrice: { type: ["string", "null"], description: "Printed multiplier price only; null if not printed" }, amount: { type: "string", description: "Printed final total of this line" }, ocrEvidence: { type: ["string", "null"], description: "Exact short visible receipt fragment for this line" } }, required: ["name", "quantity", "unitPrice", "amount", "ocrEvidence"] } }
  },
  required: ["type", "amount", "amountEvidence", "currency", "effectiveDate", "dateEvidence", "accountId", "fromAccountId", "toAccountId", "categoryId", "counterparty", "paymentMethod", "comment", "lineItems"]
};

function baseUrl(value: string): string { return value.trim().replace(/\/+$/, ""); }
function headers(key: string): Record<string, string> { return { Authorization: `Bearer ${key}` }; }
function apiError(status: number, message: unknown, operation: string): Error {
  const detail = String(message ?? "запрос отклонён");
  if (status === 429 && /credits|quota|billing/i.test(detail)) return new Error("На счёте API нет доступных средств или исчерпана квота. Проверьте Billing у провайдера.");
  if (status === 401) return new Error("API-ключ не принят провайдером");
  return new Error(`${operation} (${status}): ${detail}`);
}

function extractOutputText(response: unknown): string {
  const data = response as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof data.output_text === "string") return data.output_text;
  const pieces = data.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text" && typeof item.text === "string").map((item) => item.text!) ?? [];
  if (!pieces.length) throw new Error("ИИ не вернул текстовый результат");
  return pieces.join("\n");
}

export class OpenAiProvider implements AiProvider {
  constructor(private readonly settings: AiSettings, private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error("Введите API-ключ в настройках Buchhaltzar → ИИ");
  }

  private async response(content: unknown[], currency: string, receiptSummary = false): Promise<AiTransactionDraft> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await requestUrl({
      url: `${baseUrl(this.settings.baseUrl)}/responses`, method: "POST",
      headers: { ...headers(this.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.settings.textVisionModel, store: false,
        instructions: receiptSummary
          ? `Read only the receipt summary. Today is ${today}. Default currency is ${currency}. Return type="expense", the single FINAL CHARGED TOTAL printed near TOTAL/SUM/AMOUNT, currency, date, merchant, payment method and a short category. Set accountId="urgent". Do not read, list, calculate or reconstruct products. lineItems must be an empty array. Copy the exact visible total fragment into amountEvidence. Return only the requested schema.`
          : `Extract one bookkeeping draft. Today is ${today}. Default currency is ${currency}. Account IDs: urgent (food, groceries and essential needs), business (business activity only), fund, capital, future, cash, external. Infer a short English categoryId. Payment methods: cash, card, transfer, manual. Return lineItems as an empty array. Return only the requested schema.`,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "buchhaltzar_transaction_draft", strict: true, schema: DRAFT_SCHEMA } }
      }), throw: false
    });
    if (result.status < 200 || result.status >= 300) throw apiError(result.status, result.json?.error?.message, "Ошибка ИИ");
    return normalizeAiDraft(JSON.parse(extractOutputText(result.json)));
  }

  async transcribe(audio: Blob): Promise<string> {
    const boundary = `----Buchhaltzar${Date.now().toString(36)}`;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const field = (name: string, value: string) => chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    field("model", this.settings.transcriptionModel); field("language", "ru");
    const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${extension}"\r\nContent-Type: ${audio.type || "audio/webm"}\r\n\r\n`));
    chunks.push(new Uint8Array(await audio.arrayBuffer())); chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0); const body = new Uint8Array(size);
    let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const result = await requestUrl({ url: `${baseUrl(this.settings.baseUrl)}/audio/transcriptions`, method: "POST", headers: { ...headers(this.apiKey), "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: body.buffer, throw: false });
    if (result.status < 200 || result.status >= 300) throw apiError(result.status, result.json?.error?.message, "Ошибка транскрипции");
    const text = result.json?.text; if (typeof text !== "string" || !text.trim()) throw new Error("Речь не распознана");
    return text.trim();
  }

  async interpretText(text: string, currency: string): Promise<AiTransactionDraft> {
    const draft = await this.response([{ type: "input_text", text }], currency); draft.sourceText = text; return draft;
  }

  async recognizeReceipt(imageDataUrls: string[], currency: string): Promise<AiTransactionDraft> {
    if (!imageDataUrls.length) throw new Error("Изображение чека не выбрано");
    const content = [
      { type: "input_text", text: "Read this receipt directly from the image and transcribe printed figures exactly. The application rejects the entire result unless every explicit multiplication and the sum of all final line totals reconcile." },
      ...imageDataUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" }))
    ];
    return this.response(content, currency, true);
  }

  async testConnection(): Promise<void> {
    const result = await requestUrl({
      url: `${baseUrl(this.settings.baseUrl)}/responses`, method: "POST",
      headers: { ...headers(this.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.settings.textVisionModel, input: "Reply with OK.", max_output_tokens: 8, store: false }), throw: false
    });
    if (result.status < 200 || result.status >= 300) throw apiError(result.status, result.json?.error?.message, "Подключение не удалось");
  }
}
