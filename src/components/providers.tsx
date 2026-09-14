'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from './auth-provider';
import { SettingsProvider } from './settings-provider';
import { ToastProvider } from './ui';

export { useAuth } from './auth-provider';
export { useSettings } from './settings-provider';

export function Providers({ children }: { children: ReactNode }) {
  return <SettingsProvider><AuthProvider><ToastProvider>{children}</ToastProvider></AuthProvider></SettingsProvider>;
}
