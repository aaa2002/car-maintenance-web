'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Currency } from '@/lib/database';
import { strings, type Language, type StringKey } from '@/i18n/strings';

export type ThemePreference = 'light' | 'dark' | 'system';
type SettingsValue = { language: Language; theme: ThemePreference; currency: Currency; setLanguage: (value: Language) => void; setTheme: (value: ThemePreference) => void; setCurrency: (value: Currency) => void; t: (key: StringKey) => string };
const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [currency, setCurrencyState] = useState<Currency>('RON');

  useEffect(() => {
    setLanguageState(localStorage.getItem('vehix.language') === 'ro' ? 'ro' : 'en');
    const savedTheme = localStorage.getItem('vehix.theme');
    setThemeState(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system');
    setCurrencyState(localStorage.getItem('vehix.currency') === 'EUR' ? 'EUR' : 'RON');
  }, []);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.setAttribute('data-bs-theme', theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [theme]);

  const value = useMemo<SettingsValue>(() => ({
    language, theme, currency,
    setLanguage(next) { setLanguageState(next); localStorage.setItem('vehix.language', next); document.documentElement.lang = next; },
    setTheme(next) { setThemeState(next); localStorage.setItem('vehix.theme', next); },
    setCurrency(next) { setCurrencyState(next); localStorage.setItem('vehix.currency', next); },
    t: (key) => strings[language][key],
  }), [language, theme, currency]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
