import { AUTH_FAILURE_TEXT } from '@/lib/error-text';

export function SignedOut({ state, reason }: { state: 'config' | 'signed-out'; reason?: string | null }) {
  const failure = reason && Object.hasOwn(AUTH_FAILURE_TEXT, reason) ? AUTH_FAILURE_TEXT[reason] : null;
  return (
    <main className="gate">
      <h1>กำไรโปรเจกต์</h1>
      <p className="gate-purpose">
        บันทึกมูลค่าสัญญา เงินที่ได้รับจริง เวลาทำงาน และค่าใช้จ่ายของแต่ละโปรเจกต์
        เพื่อดูว่าโปรเจกต์นั้นเหลือกำไรจริงเท่าไร
      </p>
      {state === 'config' ? (
        <div role="alert" className="notice notice-error">
          <strong>ระบบยังไม่ได้ตั้งค่า</strong>
          <p>
            ยังไม่มีการตั้งค่าการเข้าสู่ระบบหรือที่อยู่ API ที่ถูกต้อง จึงยังเข้าสู่ระบบไม่ได้
            ผู้ดูแลตรวจสถานะได้ที่ <code>/api/health</code>
          </p>
        </div>
      ) : (
        <>
          {failure ? (
            <div role="alert" className="notice notice-error">
              <strong>เข้าสู่ระบบไม่สำเร็จ</strong>
              <p>{failure}</p>
            </div>
          ) : null}
          <p>
            <a className="button primary" href="/api/auth/login">
              เข้าสู่ระบบ
            </a>
          </p>
          <p className="muted">ข้อมูลแสดงหลังเข้าสู่ระบบเท่านั้น ระบบไม่มีข้อมูลตัวอย่างให้ดูก่อนยืนยันตัวตน</p>
        </>
      )}
    </main>
  );
}
