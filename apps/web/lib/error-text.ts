import type { ApiErrorCode } from './api-types';

export interface ErrorText {
  title: string;
  recovery: string;
}

/** Thai message and recovery by error code; raw response bodies are never shown. */
export const ERROR_TEXT: Record<ApiErrorCode, ErrorText> = {
  unauthorized: {
    title: 'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ',
    recovery: 'เข้าสู่ระบบอีกครั้ง ข้อมูลที่กรอกไว้ในฟอร์มยังอยู่ในหน้านี้',
  },
  forbidden: {
    title: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
    recovery: 'ขอสิทธิ์จากเจ้าของเวิร์กสเปซ หรือเลือกเวิร์กสเปซอื่น',
  },
  not_found: {
    title: 'ไม่พบข้อมูลที่ร้องขอ',
    recovery: 'ข้อมูลอาจถูกลบไปแล้ว เลือกรายการใหม่จากรายชื่อ',
  },
  validation_error: {
    title: 'ข้อมูลไม่ผ่านการตรวจสอบ',
    recovery: 'ตรวจสอบค่าในฟอร์มแล้วลองส่งอีกครั้ง',
  },
  idempotency_conflict: {
    title: 'คำขอนี้ซ้ำกับรายการที่ส่งไปก่อนหน้า',
    recovery: 'โหลดข้อมูลใหม่เพื่อดูว่ารายการถูกบันทึกแล้วหรือยัง ก่อนส่งซ้ำ',
  },
  service_unavailable: {
    title: 'บริการข้อมูลยังไม่พร้อมใช้งาน',
    recovery: 'รอสักครู่แล้วกดลองอีกครั้ง ข้อมูลที่กรอกยังไม่หาย',
  },
  configuration_required: {
    title: 'ระบบยังไม่ได้ตั้งค่า',
    recovery: 'ผู้ดูแลต้องตั้งค่าการเข้าสู่ระบบและที่อยู่ API ก่อนใช้งาน',
  },
  method_not_allowed: {
    title: 'ระบบไม่รองรับคำขอนี้',
    recovery: 'โหลดหน้าใหม่แล้วลองอีกครั้ง',
  },
  network: {
    title: 'เชื่อมต่อเครือข่ายไม่ได้',
    recovery: 'ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง ข้อมูลที่กรอกยังไม่หาย',
  },
};

export const AUTH_FAILURE_TEXT: Record<string, string> = {
  denied: 'ผู้ให้บริการยืนยันตัวตนปฏิเสธการเข้าสู่ระบบ',
  expired: 'โทเคนจากผู้ให้บริการหมดอายุแล้ว ลองเข้าสู่ระบบอีกครั้ง',
  invalid: 'การยืนยันตัวตนไม่สมบูรณ์หรือถูกปฏิเสธ ลองเข้าสู่ระบบอีกครั้ง',
  provider_unavailable: 'ติดต่อผู้ให้บริการยืนยันตัวตนไม่ได้ ลองใหม่ภายหลัง',
  session_too_large: 'ข้อมูลเซสชันใหญ่เกินกว่าที่คุกกี้รองรับ ผู้ดูแลต้องปรับการออกโทเคนของผู้ให้บริการ',
  not_configured: 'ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบ',
};
