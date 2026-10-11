// COMPONENT-FIXTURE verification only: real ProfitApp + synthetic API via route interception.
// This is NOT production OIDC / BFF end-to-end evidence.
import { expect, test, type Page } from '@playwright/test';
import { createSyntheticApi } from '../shared/synthetic-api';

async function mock(page: Page) {
  const api = createSyntheticApi();
  await page.route('**/api/profit/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    const r = await api.handle(req.method(), url.pathname + url.search, body, req.headers());
    await route.fulfill({
      status: r.status,
      contentType: 'application/json',
      body: r.status === 204 ? '' : JSON.stringify(r.body),
    });
  });
  return api;
}

async function open(page: Page) {
  const api = await mock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'SYNTHETIC เว็บไซต์ร้านกาแฟ' })).toBeVisible();
  return api;
}

test('screenshot of comparison workspace', async ({ page }, info) => {
  await open(page);
  await page.screenshot({ path: `test-results/${info.project.name}-comparison.png`, fullPage: true });
});

test('no horizontal overflow', async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('records a payment through the real form and highlights changed rows', async ({ page }, info) => {
  const api = await open(page);
  await page.getByRole('tab', { name: 'เงินที่ได้รับ' }).click();
  await page.getByLabel(/จำนวนเงิน/).fill('1.234');
  await page.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }).click();
  await expect(page.getByText(/ทศนิยมเกินที่สกุลเงินนี้รองรับ/)).toBeVisible();
  await page.getByLabel(/จำนวนเงิน/).fill('5000.50');
  await page.getByRole('button', { name: 'บันทึกเงินที่ได้รับ' }).click();
  await expect(page.locator('tr.flash').first()).toBeVisible();
  // signature: actual-profit equation flashes, unchanged projected equation does not
  await expect(page.locator('[data-eq="actual"]')).toHaveClass(/flash/);
  await expect(page.locator('[data-eq="projected"]')).not.toHaveClass(/flash/);
  const posts = api.log.filter((l) => l.method === 'POST');
  expect(posts).toHaveLength(1);
  await page.screenshot({ path: `test-results/${info.project.name}-after-payment.png`, fullPage: true });
});

test('creates a project via the form', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'เพิ่มโปรเจกต์' }).click();
  const form = page.getByRole('form').or(page.locator('form').filter({ hasText: 'สร้างโปรเจกต์' })).first();
  await form.getByLabel('ชื่อโปรเจกต์').fill('SYNTHETIC ใหม่');
  await form.getByLabel('ชื่อลูกค้า').fill('SYNTHETIC Client N');
  await form.getByLabel(/มูลค่าสัญญา/).fill('1500.5');
  await form.getByLabel(/ต้นทุนแรงงาน/).fill('2000');
  await form.getByRole('button', { name: 'สร้างโปรเจกต์' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'SYNTHETIC ใหม่' })).toBeVisible();
});

test('recording action is inside the first viewport and moves focus to the chosen inline form', async ({ page }) => {
  await open(page);
  const viewport = page.viewportSize()!;
  const go = page.getByRole('button', { name: 'เพิ่มรายการ' });
  const select = page.getByLabel('ประเภทที่จะเพิ่ม');
  for (const el of [go, select]) {
    await expect(el).toBeVisible();
    const box = (await el.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  await select.selectOption('payments');
  await go.click();
  await expect(page.getByRole('tab', { name: 'เงินที่ได้รับ' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel(/จำนวนเงิน/)).toBeFocused();
});

test('tabular digits have equal width for equal-length numbers', async ({ page }) => {
  await open(page);
  const widths = await page.evaluate(async () => {
    await document.fonts.ready;
    const probe = (text: string) => {
      const s = document.createElement('span');
      s.style.cssText = 'font-variant-numeric:tabular-nums;position:absolute;white-space:pre';
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return [probe('1111111'), probe('8080808')];
  });
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.5);
});
