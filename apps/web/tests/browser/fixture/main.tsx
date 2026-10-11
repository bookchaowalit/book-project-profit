// TEST-ONLY component fixture. Not a Next route, never shipped, no auth.
// Renders the real ProfitApp; Playwright intercepts /api/profit/* with synthetic data.
import '@fontsource-variable/noto-sans-thai';
import '../../../app/globals.css';
import { createRoot } from 'react-dom/client';
import { ProfitApp } from '@/components/profit-app';

createRoot(document.getElementById('root')!).render(<ProfitApp displayName="ผู้ใช้สังเคราะห์ (fixture)" />);
