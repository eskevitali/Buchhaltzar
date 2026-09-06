const CURRENCY_DECIMALS: Record<string, number> = { EUR: 2, RUB: 2, USD: 2, CHF: 2, GBP: 2, JPY: 0 };

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function parseAmount(value: string, currency: string): bigint {
  const decimals = currencyDecimals(currency);
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Введите положительную сумму числом");
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`Для ${currency} допустимо знаков после запятой: ${decimals}`);
  const padded = fraction.padEnd(decimals, "0");
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (result <= 0n) throw new Error("Сумма должна быть больше нуля");
  return result;
}

export function parseSignedAmount(value: string, currency: string): bigint {
  const normalized = value.trim(); const negative = normalized.startsWith("-");
  const amount = parseAmount(negative ? normalized.slice(1) : normalized, currency);
  return negative ? -amount : amount;
}

export function formatMoney(minorUnits: bigint, currency: string, locale = "ru-RU"): string {
  const decimals = currencyDecimals(currency);
  const sign = minorUnits < 0n ? "-" : "";
  const absolute = minorUnits < 0n ? -minorUnits : minorUnits;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const numeric = decimals ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
  const safe = Number(numeric);
  if (Number.isSafeInteger(Number(whole))) {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: decimals }).format(safe);
  }
  return `${sign}${whole}${decimals ? `,${fraction}` : ""} ${currency}`;
}

export function splitEvenly(total: bigint, count: number): bigint[] {
  if (total <= 0n || count <= 0) throw new Error("Невозможно распределить сумму");
  const divisor = BigInt(count);
  const base = total / divisor;
  const remainder = total % divisor;
  return Array.from({ length: count }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}
