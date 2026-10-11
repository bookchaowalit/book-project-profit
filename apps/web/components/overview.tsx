'use client';

import type { WorkspaceSummary } from '@/lib/api-types';
import { formatMinutes, formatMoney, isCurrency, signOf } from '@/lib/money';

export function Overview({ summary }: { summary: WorkspaceSummary }) {
  return (
    <section aria-labelledby="overview-title" className="sheet" id="overview">
      <h2 id="overview-title">ภาพรวมเวิร์กสเปซแยกตามสกุลเงิน</h2>
      <p className="muted">
        {summary.project_count} โปรเจกต์ ระบบไม่รวมต่างสกุลเงินเข้าด้วยกันและไม่แปลงอัตราแลกเปลี่ยน
      </p>
      {summary.totals_by_currency.length === 0 ? (
        <p className="empty">ยังไม่มีโปรเจกต์ที่ให้สรุป</p>
      ) : (
        <table className="stack-table overview">
          <caption className="sr-only">ยอดรวมแยกตามสกุลเงิน</caption>
          <thead>
            <tr>
              <th scope="col">สกุลเงิน</th>
              <th scope="col">โปรเจกต์</th>
              <th scope="col">รับจริง</th>
              <th scope="col">ค่าใช้จ่าย</th>
              <th scope="col">ต้นทุนแรงงาน</th>
              <th scope="col">เงินสดคงเหลือ</th>
              <th scope="col">กำไรจริง</th>
              <th scope="col">กำไรคาดการณ์</th>
              <th scope="col">เวลา</th>
            </tr>
          </thead>
          <tbody>
            {summary.totals_by_currency.map((t) => {
              if (!isCurrency(t.currency)) {
                return (
                  <tr key={t.currency}>
                    <th scope="row">{t.currency}</th>
                    <td colSpan={8}>สกุลเงินนี้ระบบยังไม่รองรับการแสดงผล</td>
                  </tr>
                );
              }
              const c = t.currency;
              return (
                <tr key={c}>
                  <th scope="row">{c}</th>
                  <td data-label="โปรเจกต์" className="num">{t.project_count}</td>
                  <td data-label="รับจริง" className="num">{formatMoney(t.received_minor, c)}</td>
                  <td data-label="ค่าใช้จ่าย" className="num">{formatMoney(t.expense_minor, c)}</td>
                  <td data-label="ต้นทุนแรงงาน" className="num">{formatMoney(t.labor_cost_minor, c)}</td>
                  <td data-label="เงินสดคงเหลือ" className={`num ${signOf(t.cash_surplus_minor)}`}>{formatMoney(t.cash_surplus_minor, c, { signed: true })}</td>
                  <td data-label="กำไรจริง" className={`num ${signOf(t.actual_profit_minor)}`}>{formatMoney(t.actual_profit_minor, c, { signed: true })}</td>
                  <td data-label="กำไรคาดการณ์" className={`num ${signOf(t.projected_profit_minor)}`}>{formatMoney(t.projected_profit_minor, c, { signed: true })}</td>
                  <td data-label="เวลา" className="num">{formatMinutes(t.total_minutes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
