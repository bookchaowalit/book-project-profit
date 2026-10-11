import { describe, expect, it } from 'vitest';
import {
  formatMinutes,
  formatMoney,
  formatPercent,
  minorDifference,
  parseApiMinor,
  parseMinutesInput,
  parseMoneyInput,
} from '@/lib/money';

describe('parseMoneyInput', () => {
  it('converts decimals to exact minor units', () => {
    expect(parseMoneyInput('1250.50', 'THB')).toEqual({ ok: true, minor: '125050' });
    expect(parseMoneyInput('1250.5', 'USD')).toEqual({ ok: true, minor: '125050' });
    expect(parseMoneyInput('0.07', 'EUR')).toEqual({ ok: true, minor: '7' });
    expect(parseMoneyInput('  12 ', 'GBP')).toEqual({ ok: true, minor: '1200' });
  });

  it('treats JPY as zero-decimal', () => {
    expect(parseMoneyInput('1500', 'JPY')).toEqual({ ok: true, minor: '1500' });
    expect(parseMoneyInput('1500.5', 'JPY')).toEqual({ ok: false, error: 'precision' });
    expect(parseMoneyInput('1500.0', 'JPY')).toEqual({ ok: false, error: 'precision' });
  });

  it('rejects instead of rounding excessive precision', () => {
    expect(parseMoneyInput('1.005', 'THB')).toEqual({ ok: false, error: 'precision' });
    expect(parseMoneyInput('0.001', 'USD')).toEqual({ ok: false, error: 'precision' });
  });

  it('rejects invalid, exponent, comma, negative and empty input', () => {
    expect(parseMoneyInput('', 'THB')).toEqual({ ok: false, error: 'empty' });
    expect(parseMoneyInput('1e3', 'THB')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('1,5', 'THB')).toEqual({ ok: false, error: 'comma' });
    expect(parseMoneyInput('1,500', 'THB')).toEqual({ ok: false, error: 'comma' });
    expect(parseMoneyInput('-1', 'THB')).toEqual({ ok: false, error: 'negative' });
    expect(parseMoneyInput('.5', 'THB')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('5.', 'THB')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('NaN', 'THB')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('0x10', 'THB')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('1 000', 'THB')).toEqual({ ok: false, error: 'invalid' });
  });

  it('enforces the 15-digit minor-unit maximum without Number()', () => {
    expect(parseMoneyInput('9999999999999.99', 'THB')).toEqual({ ok: true, minor: '999999999999999' });
    expect(parseMoneyInput('10000000000000.00', 'THB')).toEqual({ ok: false, error: 'too_large' });
    expect(parseMoneyInput('999999999999999', 'JPY')).toEqual({ ok: true, minor: '999999999999999' });
    expect(parseMoneyInput('1000000000000000', 'JPY')).toEqual({ ok: false, error: 'too_large' });
  });

  it('can require a positive amount', () => {
    expect(parseMoneyInput('0', 'THB', { allowZero: false })).toEqual({ ok: false, error: 'zero' });
    expect(parseMoneyInput('0.00', 'THB')).toEqual({ ok: true, minor: '0' });
  });
});

describe('formatMoney', () => {
  it('formats exact large amounts beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatMoney('999999999999999999', 'THB')).toBe('9,999,999,999,999,999.99 THB');
    expect(formatMoney('9007199254740993', 'JPY')).toBe('9,007,199,254,740,993 JPY');
  });

  it('shows negatives with a real minus sign and optional plus', () => {
    expect(formatMoney('-12345', 'USD')).toBe('\u2212123.45 USD');
    expect(formatMoney('-5', 'EUR')).toBe('\u22120.05 EUR');
    expect(formatMoney('5', 'GBP', { signed: true })).toBe('+0.05 GBP');
    expect(formatMoney('0', 'THB', { signed: true })).toBe('0.00 THB');
    expect(formatMoney('-1500', 'JPY')).toBe('\u22121,500 JPY');
  });

  it('reports malformed API values as unavailable rather than zero', () => {
    expect(formatMoney(null, 'THB')).toBe('ไม่มีข้อมูล');
    expect(formatMoney('1.5', 'THB')).toBe('ไม่มีข้อมูล');
    expect(formatMoney(12, 'THB')).toBe('ไม่มีข้อมูล');
    expect(formatMoney('-0', 'THB')).toBe('ไม่มีข้อมูล');
  });
});

describe('helpers', () => {
  it('parses API minor strings', () => {
    expect(parseApiMinor('-9007199254740993')).toBe(-9007199254740993n);
    expect(parseApiMinor('01')).toBeNull();
  });
  it('computes exact differences', () => {
    expect(minorDifference('9007199254740993', '1')).toBe('9007199254740992');
    expect(minorDifference('5', '10')).toBe('-5');
    expect(minorDifference('x', '1')).toBeNull();
  });
  it('formats minutes and percentages', () => {
    expect(formatMinutes(750)).toBe('12 ชม. 30 นาที');
    expect(formatMinutes('45')).toBe('45 นาที');
    expect(formatMinutes(0)).toBe('0 นาที');
    expect(formatMinutes(1.5)).toBe('ไม่มีข้อมูล');
    expect(formatPercent('-12.5')).toBe('\u221212.5%');
    expect(formatPercent(null)).toBe('ไม่มีข้อมูล');
  });
  it('validates minute input as integer 1..1440', () => {
    expect(parseMinutesInput('90')).toEqual({ ok: true, minutes: 90 });
    for (const bad of ['0', '1441', '1.5', '-3', '', 'abc', '1e2']) {
      expect(parseMinutesInput(bad).ok).toBe(false);
    }
  });
});
