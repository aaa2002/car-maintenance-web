'use client';

import { useEffect, useState } from 'react';
import { addDays, localDate, mondayOf, today } from '@/lib/format';
import { DateField } from './date-field';
import { useSettings } from './providers';

/** The week in the page URL (?week=YYYY-MM-DD, a Monday), defaulting to last week; kept in sync when it changes. */
export function useWeekParam(fallback = addDays(mondayOf(today()), -7)) {
  const [week, setWeekState] = useState(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(location.search).get('week');
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) setWeekState(mondayOf(value));
    setReady(true);
  }, []);
  const setWeek = (value: string) => {
    const monday = mondayOf(value);
    setWeekState(monday);
    const url = new URL(location.href); url.searchParams.set('week', monday);
    history.replaceState(history.state, '', url);
  };
  return { week, setWeek, ready };
}

export function WeekPicker({ id, week, onChange }: { id: string; week: string; onChange: (week: string) => void }) {
  const { t, language } = useSettings();
  const last = mondayOf(today());
  return <div className="week-picker">
    <div className="segmented">
      <button type="button" aria-label={t('previous')} onClick={() => onChange(addDays(week, -7))}><i className="bi bi-chevron-left" /></button>
      <button type="button" className={week === addDays(last, -7) ? 'active' : ''} onClick={() => onChange(addDays(last, -7))}>{t('lastWeek')}</button>
      <button type="button" aria-label={t('next')} disabled={week >= last} onClick={() => onChange(addDays(week, 7))}><i className="bi bi-chevron-right" /></button>
    </div>
    <div className="week-picker-date"><DateField id={id} max={today()} value={week} onChange={(value) => onChange(mondayOf(value))} /></div>
    <span className="small text-body-secondary text-nowrap">{localDate(week, language)} – {localDate(addDays(week, 6), language)}</span>
  </div>;
}
