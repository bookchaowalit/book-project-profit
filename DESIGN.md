---
name: "Project Profit Tracker"
description: "Thai-first ruled sheets for inspecting project profit."
colors:
  paper: "#f6f7f5"
  ink: "#17211b"
  muted: "#4a5850"
  rule: "#c9d0ca"
  rule-strong: "#17211b"
  green: "#256447"
  brick: "#a33a37"
  field: "#ffffff"
  flash: "rgba(37, 100, 71, 0.16)"
  control-hover: "#e8ece8"
  primary-hover: "#1d5039"
  danger-hover: "#f4e5e4"
  field-border: "#6c7a71"
  project-selected: "#dbe5dd"
typography:
  title:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  headline:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  brand:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.6
  supporting:
    fontFamily: "'Noto Sans Thai Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "3px"
spacing:
  quarter: "0.25rem"
  half: "0.5rem"
  three-quarter: "0.75rem"
  unit: "1rem"
  section-offset: "1.25rem"
  main-inline: "1.5rem"
  sheet-gap: "2rem"
components:
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.9rem"
  button-hover:
    backgroundColor: "{colors.control-hover}"
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.field}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.9rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.brick}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.9rem"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.6rem"
  project-navigation:
    backgroundColor: "transparent"
    padding: "0.6rem 0.5rem"
    width: "100%"
  project-navigation-selected:
    backgroundColor: "{colors.project-selected}"
    textColor: "{colors.green}"
  transaction-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "0.4rem 1rem"
  transaction-tab-selected:
    textColor: "{colors.ink}"
  notice:
    backgroundColor: "{colors.field}"
    padding: "0.6rem 0.8rem"
---

# Design System: Project Profit Tracker

## Overview

**Creative North Star: "Profit Diff (implemented; unconfirmed)"**

ระบบที่สกัดจากโค้ดจริง: กระดาษขาวอมเทา เส้นแบ่งชัด ตัวเลขอ่านเทียบกันได้ และฟอร์มภาษาไทยในลำดับเอกสาร ไม่ใช่ชุด metric cards แยกขาดจากสมการ ชื่อ Profit Diff เป็น code-led fallback จาก surface brief (seed `ebd4384d`); ยังไม่มี approved comp หรือ aesthetic approval

เอกสารนี้บันทึก visual system ไม่ยืนยันการทำงาน production ทั้งระบบ การแก้ material findings สามรายการได้รับ scoped disposition SHIP แล้ว; ผล automated checks เป็นหลักฐานแยกจาก visual system และไม่มีหลักฐาน live OIDC หรือ cloud deployment จากการตรวจครั้งนี้

**Key Characteristics:**
- Thai-first, self-hosted Noto Sans Thai.
- Flat ruled sheets; compact outlined controls.
- Exact signed money, currency context, and visible equations.
- Inline forms, visible keyboard focus, explicit stale recovery.

หลักฐาน: `apps/web/app/globals.css`, `layout.tsx`, `page.tsx`; `apps/web/components/{profit-app,comparison,transactions,ui}.tsx`; `apps/web/lib/money.ts` สกรีนช็อต `.impeccable/review/desktop.png` ยืนยัน material และ composition ด้วย synthetic fixture เท่านั้น ค่าและ behavior ยึด source ปัจจุบัน

## Colors

สีใน frontmatter คือค่าตาม source; ไม่สร้าง Secondary/Tertiary palette หรือ tonal scale เพิ่ม

### Primary
- **Green** (`green`): primary action, links, keyboard focus และผลบวก; `primary-hover` เป็นสถานะ hover ของปุ่ม
- **Brick** (`brick`): ผลลบ, invalid field, destructive confirmation และ stale/error boundary; `danger-hover` รองรับ hover ของปุ่มลบ
- **Flash** (`flash`): tint ชั่วคราวของแถวที่ค่าจริงเปลี่ยนหลัง canonical refetch ไม่ใช่สถานะสำเร็จถาวร

### Neutral
- **Paper / Field** (`paper`, `field`): พื้นเอกสารกับช่องกรอกและ notice
- **Ink / Muted** (`ink`, `muted`): ข้อความหลักกับคำอธิบายที่ยังต้องอ่านได้
- **Rule / Strong Rule** (`rule`, `rule-strong`): แบ่งแถวกับเน้นหัวตาราง/ผลรวม; strong rule ใช้ค่าเดียวกับ ink ตาม CSS
- **Field Border / Control Hover / Project Selected** (`field-border`, `control-hover`, `project-selected`): ขอบช่องกรอก, hover แบบเบา, พื้นรายการที่เลือก

**The Signed Result Rule.** ผลบวก/ลบต้องมีเครื่องหมายและสกุลเงินควบคู่สี; สีเพียงอย่างเดียวไม่ใช่ข้อมูล

## Typography

**Display / Body Font:** Noto Sans Thai Variable พร้อม Noto Sans Thai, system-ui, sans-serif fallback; self-hosted ผ่าน `@fontsource-variable/noto-sans-thai` ใน layout ไม่ใช้ display face อีกชุด

### Hierarchy
- **Title:** ชื่อโปรเจกต์; **Brand:** ชื่อแอปใน top bar; **Headline:** หัว section ตาม frontmatter
- **Body:** ข้อความและค่าในตาราง; สมการใช้ heading (1rem, 600, line-height 1.3)
- **Label:** label ทั่วไปและหัวคอลัมน์; **Supporting:** hint, metadata, สถานะโหลด; record-type label ใช้ supporting size
- ปุ่มและ tab สืบทอด body font ใช้น้ำหนัก 500; selected navigation/tab ใช้ 700; total row ใช้ headline size และน้ำหนัก 700

**The Exact Number Rule.** ใช้ `tabular-nums lining-nums` และไม่ตัดบรรทัดภายในค่าเงิน; format ผ่าน BigInt minor-unit strings ไม่แปลงจำนวนเงินเป็น Number สกุลเงินติดอยู่กับค่า และ unknown ไม่ถูกแทนด้วยศูนย์

paragraph จำกัดความยาว (72ch); heading balance และชื่อโปรเจกต์ wrap ได้ ไม่บังคับย่อชื่อใน sheet

## Layout

- Top bar wrap ได้ ความสูงขั้นต่ำ (3.5rem); desktop grid เป็น rail (280px) กับพื้นที่หลัก `minmax(0, 1fr)`
- Main padding (1rem 1.5rem 3rem); sheet กว้างสูงสุด (68rem) และเว้นท้ายตาม `sheet-gap` ไม่มี card grid
- Form grid ใช้ `repeat(auto-fit, minmax(13rem, 1fr))`, gap (0.75rem 1rem); action groups wrap ได้
- ที่ `max-width: 900px` rail ย้ายขึ้นบนและเปลี่ยน list เป็น labeled select, main padding เหลือ (1rem), สมการเปลี่ยนจาก label column (14rem) เป็นหนึ่งคอลัมน์
- ที่ `max-width: 720px` stack-table เป็น labeled entries: ซ่อน thead แบบ visually hidden, แสดง `data-label` คู่กับแต่ละค่า และ form grid เหลือหนึ่งคอลัมน์ ไม่ตัดข้อมูลออก
- Transactions อยู่ใน document flow; tab strip เลื่อนแนวนอนได้ ไม่ย้ายฟอร์มเป็น modal

## Elevation & Depth

ไม่มี box shadow, gradient หรือ lifted card ใน stylesheet ที่ตรวจ Depth เกิดจากเส้นบางระหว่างแถว เส้นเข้มที่ header/total และพื้น field/notice/selected item พื้น sheet ใช้กระดาษร่วมกับ shell

**The Ruled Sheet Rule.** ใช้เส้นแบ่งเพื่อให้เทียบค่าและอ่านสมการได้ ไม่ยกทุก section เป็นกล่องมีเงา

## Shapes

Control โค้งเล็กตาม `rounded.control` (3px); sheet, notice และ rail ไม่มี radius declaration ช่องกรอกและปุ่มใช้ stroke (1px); invalid input เพิ่มเป็น (2px); selected tab ใช้ underline (3px) และ stale comparison ใช้ dashed top border (2px) รูปทรงสถานะเหล่านี้เสริมข้อความ ไม่แทนข้อความ

## Components

### Buttons
- Outlined default, filled green primary, brick outlined danger ตาม frontmatter; min-height (2.5rem), weight 500
- Hover เปลี่ยน background (120ms) ด้วย `cubic-bezier(0.16, 1, 0.3, 1)`; disabled opacity (0.55), cursor `not-allowed`
- Focus-visible outline (2px solid green), offset (2px); ไม่มี hover transform

### Inputs / Fields
- Input/select มี white field, field-border, min-height (2.5rem); label เชื่อม `htmlFor`/id, hint/error เชื่อม `aria-describedby`
- Invalid ใช้ `aria-invalid`, brick border และข้อความ error (supporting size, weight 600); validation focus ไป field แรกที่ผิด ไม่ใช้ placeholder แทน label

### Navigation
- Project list ใช้ full-width text buttons มี metadata; selected ใช้พื้น project-selected, green, weight 700 และ `aria-current`
- Transactions เป็น tablist/tabpanel, roving tabindex; ArrowLeft/Right, Home/End เปลี่ยน tab และ focus; selected ใช้ ink กับ green underline ไม่ได้สร้าง pill/chip variant

### Notices / Containers
- White notice ใช้ rule border กับ padding ตาม frontmatter; error/stale เปลี่ยนขอบและหัวข้อความเป็น brick พร้อม `role="alert"`
- Stale บอกชัดว่าค่าเก่า; หาก write สำเร็จแต่ refetch ล้มเหลว ต้องบอกว่าบันทึกแล้ว ปุ่มโหลดผลรวมทำ GET เท่านั้น ไม่ส่ง write ซ้ำ; unauthorized ให้เข้าสู่ระบบแทน retry
- Loading/refresh มีข้อความ `role="status"`; ไม่มีผลลัพธ์แสดงสาเหตุ ไม่สมมติเป็นศูนย์

### Profit Comparison / Record Action
- Semantic table เทียบสัญญากับรับจริง, numeric columns ชิดขวา; total ใช้เส้นเข้มและน้ำหนัก 700 สมการแยก actual/projected/cash พร้อมตัวหารเวลาตาม source
- Record action เป็น labeled type select กับ primary “เพิ่มรายการ” ก่อน comparison table เลือกชนิดเดียวกับ transaction tab แล้ว scroll แบบ `auto` และ focus ช่อง minutes/amount ใน inline form; viewer ไม่มี write form/action
- แถวและสมการที่ค่าเปลี่ยนหลัง same-project refetch ใช้ background transition (180ms); changed-row state ถูกล้างหลัง (1400ms) ไม่ใช่ animation duration (180ms) เดียวกัน
- Reduced motion ปิด control/row transitions และ flash tint; ไม่พึ่ง flash เป็นคำยืนยันเพียงอย่างเดียว ใช้ live announcement หลัง canonical GET สำเร็จ

## Do's and Don'ts

### Do:
- **Do** คง label ภาษาไทย, สกุลเงิน และเครื่องหมายผลลัพธ์ควบคู่สี
- **Do** รักษาเส้นแบ่งและ numeric alignment รวมถึง data-label เมื่อ table stack
- **Do** ใช้ inline form, visible focus และข้อความ loading/error/stale ที่บอกขั้นตอนกู้คืน
- **Do** แยก persisted write ออกจาก canonical totals refresh และเคารพ reduced motion

### Don't:
- **Don't** รวมต่างสกุลเงิน หรือแสดงค่า unknown/ไม่มีตัวหารเวลาเป็นศูนย์
- **Don't** แทนสมการด้วย KPI cards ที่ตัดบริบทสัญญากับเงินรับจริงออก
- **Don't** ยืนยันยอดล่าสุดจาก write success ก่อน canonical GET สำเร็จ หรือ retry write จากปุ่มโหลดผลรวม
- **Don't** อ้างว่า fallback aesthetic, synthetic screenshots หรือ scoped SHIP คือ aesthetic approval หรือ production deployment

Not canonized / not repaired: surface brief ยังบรรยาย primary add action ใน transaction section ขณะที่ source มี typed record action ก่อนตาราง; บันทึก behavior ตาม source และไม่แก้ brief นอกขอบเขต ไม่มี craft-floor defect ที่สังเกตได้ใน source sample/desktop capture; ไม่ถือเป็น comprehensive UI audit และไม่สร้าง tonal ramps ที่ source ไม่มี
