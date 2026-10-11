import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/noto-sans-thai';
import './globals.css';

export const metadata: Metadata = {
  title: 'กำไรโปรเจกต์',
  description: 'เปรียบเทียบมูลค่าสัญญากับเงินที่ได้รับจริง หักค่าแรงและค่าใช้จ่ายของแต่ละโปรเจกต์',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
