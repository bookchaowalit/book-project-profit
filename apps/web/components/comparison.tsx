'use client';

import type { ReactNode } from 'react';
import type { Project } from '@/lib/api-types';
import { formatMinutes, formatMoney, formatPercent, isCurrency, minorDifference, signOf, toBigInt, type Currency } from '@/lib/money';
import type { RowKey } from '@/lib/forms';

const STATUS_TEXT: Record<string, string> = { active: 'กำลังดำเนินการ', completed: 'เสร็จแล้ว', archived: 'เก็บเข้าคลัง' };

function Value({ value, currency }: { value: unknown; currency: Currency }) {
  const sign = signOf(value);
  return <span className={`num ${sign}`}>{formatMoney(value, currency, { signed: true })}</span>;
}

export function Comparison({
  project,
  changed,
  actions,
  stale = false,
}: {
  project: Project;
  changed: ReadonlySet<RowKey>;
  actions?: ReactNode;
  stale?: boolean;
}) {
  if (!isCurrency(project.currency)) {
    return (
      <p role="alert" className="notice notice-error">
        โปรเจกต์นี้ใช้สกุลเงิน {project.currency} ซึ่งระบบยังไม่รองรับการแสดงผล
      </p>
    );
  }
  const cur = project.currency;
  const s = project.summary;
  const flash = (key: RowKey) => (changed.has(key) ? 'flash' : '');
  const outstanding = minorDifference(project.contract_value_minor, s.received_minor);
  const minutes = toBigInt(s.total_minutes);
  const hasTime = minutes !== null && minutes > 0n;
  return (
    <section aria-labelledby="comparison-title" className="sheet" data-stale={stale ? 'true' : undefined}>
      <div className="sheet-head">
        <h2 id="comparison-title">{project.name}</h2>
        <p className="muted">
          ลูกค้า {project.client_name} · สกุลเงิน {cur} · {STATUS_TEXT[project.status] ?? project.status}
        </p>
        {actions}
      </div>
      <table className="diff stack-table">
        <caption className="sr-only">เปรียบเทียบสัญญากับเงินที่ได้รับจริง หน่วย {cur}</caption>
        <thead>
          <tr>
            <th scope="col">รายการ</th>
            <th scope="col">ตามสัญญา</th>
            <th scope="col">ได้รับจริง</th>
          </tr>
        </thead>
        <tbody>
          <tr className={flash('revenue')}>
            <th scope="row">รายได้</th>
            <td data-label="ตามสัญญา"><span className="num">{formatMoney(project.contract_value_minor, cur)}</span></td>
            <td data-label="ได้รับจริง"><span className="num">{formatMoney(s.received_minor, cur)}</span></td>
          </tr>
          <tr className={flash('expense')}>
            <th scope="row">หัก ค่าใช้จ่ายตรงที่บันทึก</th>
            <td data-label="ตามสัญญา"><span className="num">{formatMoney(s.expense_minor, cur)}</span></td>
            <td data-label="ได้รับจริง"><span className="num">{formatMoney(s.expense_minor, cur)}</span></td>
          </tr>
          <tr className={flash('labor')}>
            <th scope="row">หัก ต้นทุนแรงงานที่บันทึก</th>
            <td data-label="ตามสัญญา"><span className="num">{formatMoney(s.labor_cost_minor, cur)}</span></td>
            <td data-label="ได้รับจริง"><span className="num">{formatMoney(s.labor_cost_minor, cur)}</span></td>
          </tr>
          <tr className={`total ${flash('profit')}`}>
            <th scope="row">กำไร</th>
            <td data-label="ตามสัญญา (กำไรคาดการณ์)"><Value value={s.projected_profit_minor} currency={cur} /></td>
            <td data-label="ได้รับจริง (กำไรจริง)"><Value value={s.actual_profit_minor} currency={cur} /></td>
          </tr>
        </tbody>
      </table>

      <div className="equation" aria-labelledby="equation-title" role="group">
        <h3 id="equation-title">สมการที่ใช้คำนวณ</h3>
        <dl>
          <div data-eq="actual" className={flash('actual')}>
            <dt>กำไรจริง</dt>
            <dd>
              รับจริง <span className="num">{formatMoney(s.received_minor, cur)}</span> − ค่าใช้จ่าย{' '}
              <span className="num">{formatMoney(s.expense_minor, cur)}</span> − แรงงาน{' '}
              <span className="num">{formatMoney(s.labor_cost_minor, cur)}</span> ={' '}
              <Value value={s.actual_profit_minor} currency={cur} />
            </dd>
          </div>
          <div data-eq="projected" className={flash('projected')}>
            <dt>กำไรคาดการณ์</dt>
            <dd>
              สัญญา <span className="num">{formatMoney(project.contract_value_minor, cur)}</span> − ค่าใช้จ่าย − แรงงาน ={' '}
              <Value value={s.projected_profit_minor} currency={cur} />
              <span className="hint block">ใช้เฉพาะต้นทุนที่บันทึกแล้ว ไม่ได้คาดการณ์ต้นทุนที่ยังไม่เกิด</span>
            </dd>
          </div>
          <div data-eq="cash" className={flash('cash')}>
            <dt>เงินสดคงเหลือ</dt>
            <dd>
              รับจริง − ค่าใช้จ่าย = <Value value={s.cash_surplus_minor} currency={cur} />
              <span className="hint block">ยังไม่หักต้นทุนแรงงาน จึงไม่ใช่กำไร</span>
            </dd>
          </div>
          <div className={flash('revenue')}>
            <dt>ยอดตามสัญญาที่ยังไม่ได้รับ</dt>
            <dd>
              สัญญา − รับจริง = {outstanding === null ? 'ไม่มีข้อมูล' : <Value value={outstanding} currency={cur} />}
            </dd>
          </div>
          <div className={flash('time')}>
            <dt>เวลาที่ใช้เป็นตัวหาร</dt>
            <dd>
              <span className="num">{formatMinutes(s.total_minutes)}</span>
              {minutes !== null ? <span className="num"> ({minutes.toString()} นาที)</span> : null}
            </dd>
          </div>
          <div className={flash('time')}>
            <dt>กำไรต่อชั่วโมง</dt>
            <dd>
              {s.profit_per_hour_minor === null || !hasTime ? (
                <>ยังคำนวณไม่ได้ เพราะยังไม่มีเวลาที่บันทึก (ไม่ใช่ 0)</>
              ) : (
                <>
                  กำไรจริง ÷ เวลาทำงาน = <Value value={s.profit_per_hour_minor} currency={cur} /> ต่อชั่วโมง
                </>
              )}
            </dd>
          </div>
          <div data-eq="margin" className={flash('margin')}>
            <dt>อัตรากำไร</dt>
            <dd>
              {s.margin_percent === null ? (
                <>ยังคำนวณไม่ได้ เพราะยังไม่มีข้อมูลเพียงพอ</>
              ) : (
                <span className="num">{formatPercent(s.margin_percent)}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
