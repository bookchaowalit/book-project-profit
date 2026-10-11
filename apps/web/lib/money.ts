// Pure BigInt money helpers. API monetary values are decimal strings of integer
// minor units. Number() is never applied to an amount.

export const CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];

const DECIMALS: Record<Currency, number> = { THB: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 };
export const MAX_MINOR_DIGITS = 15;

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function currencyDecimals(currency: Currency): number {
  return DECIMALS[currency];
}

export type MoneyParseError =
  | 'empty'
  | 'invalid'
  | 'negative'
  | 'comma'
  | 'precision'
  | 'too_large'
  | 'zero';

export type MoneyParse = { ok: true; minor: string } | { ok: false; error: MoneyParseError };

/** Parse an API value (decimal string, may be negative). Returns null when malformed. */
export function parseApiMinor(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value) || value === '-0') return null;
  return BigInt(value);
}

/** Parse a human decimal such as "1250.50" into canonical non-negative minor units. */
export function parseMoneyInput(
  text: string,
  currency: Currency,
  options: { allowZero?: boolean } = {},
): MoneyParse {
  const allowZero = options.allowZero ?? true;
  const value = text.trim();
  if (value === '') return { ok: false, error: 'empty' };
  if (value.includes(',')) return { ok: false, error: 'comma' };
  if (value.startsWith('-')) return { ok: false, error: 'negative' };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return { ok: false, error: 'invalid' };
  const decimals = DECIMALS[currency];
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return { ok: false, error: 'precision' };
  const minor = BigInt(match[1]! + fraction.padEnd(decimals, '0'));
  if (minor.toString().length > MAX_MINOR_DIGITS) return { ok: false, error: 'too_large' };
  if (minor === 0n && !allowZero) return { ok: false, error: 'zero' };
  return { ok: true, minor: minor.toString() };
}

export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Exact decimal text without grouping, e.g. 123456n THB -> "1234.56". */
export function minorToDecimal(minor: bigint, currency: Currency): string {
  const decimals = DECIMALS[currency];
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

export const UNAVAILABLE = 'ไม่มีข้อมูล';

/** Format an API minor-unit string for display. `signed` adds "+" to positive values. */
export function formatMoney(
  value: unknown,
  currency: Currency,
  options: { signed?: boolean } = {},
): string {
  const minor = parseApiMinor(value);
  if (minor === null) return UNAVAILABLE;
  const decimal = minorToDecimal(minor < 0n ? -minor : minor, currency);
  const [whole = '0', fraction] = decimal.split('.');
  const body = `${groupDigits(whole)}${fraction !== undefined ? `.${fraction}` : ''} ${currency}`;
  if (minor < 0n) return `\u2212${body}`;
  if (minor > 0n && options.signed) return `+${body}`;
  return body;
}

export function signOf(value: unknown): 'gain' | 'loss' | 'zero' | 'unknown' {
  const minor = parseApiMinor(value);
  if (minor === null) return 'unknown';
  return minor > 0n ? 'gain' : minor < 0n ? 'loss' : 'zero';
}

/** Integer-valued API field (string or safe integer) as BigInt. */
export function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

export function formatMinutes(value: unknown): string {
  const minutes = toBigInt(value);
  if (minutes === null || minutes < 0n) return UNAVAILABLE;
  const hours = minutes / 60n;
  const rest = minutes % 60n;
  const parts: string[] = [];
  if (hours > 0n) parts.push(`${groupDigits(hours.toString())} ชม.`);
  if (rest > 0n || hours === 0n) parts.push(`${rest} นาที`);
  return parts.join(' ');
}

export type MinutesParse = { ok: true; minutes: number } | { ok: false };
export function parseMinutesInput(text: string): MinutesParse {
  const value = text.trim();
  if (!/^\d{1,4}$/.test(value)) return { ok: false };
  const minutes = Number.parseInt(value, 10);
  return minutes >= 1 && minutes <= 1440 ? { ok: true, minutes } : { ok: false };
}

/** margin_percent is a decimal string from the API; show verbatim when well formed. */
export function formatPercent(value: unknown): string {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
    ? `${value.startsWith('-') ? '\u2212' + value.slice(1) : value}%`
    : UNAVAILABLE;
}

/** Exact difference of two API minor strings; null if either is malformed. */
export function minorDifference(a: unknown, b: unknown): string | null {
  const left = parseApiMinor(a);
  const right = parseApiMinor(b);
  return left === null || right === null ? null : (left - right).toString();
}
