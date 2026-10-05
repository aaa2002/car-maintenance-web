'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import { enGB, ro } from 'react-day-picker/locale';
import { dateInputValue, today } from '@/lib/format';
import { useSettings } from './providers';
import { useAnchoredPopover } from './use-anchored-popover';

// Values stay in the same yyyy-mm-dd shape the native date input used.
const parse = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
};

type DateFieldProps = { id: string; value: string; onChange: (value: string) => void; min?: string; max?: string; invalid?: boolean; autoFocus?: boolean };

export function DateField({ id, value, onChange, min, max, invalid, autoFocus }: DateFieldProps) {
  const { t, language } = useSettings();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const valueId = useId();
  const selected = parse(value);
  const minDate = min ? parse(min) : undefined;
  const maxDate = max ? parse(max) : undefined;
  const disabled: Matcher[] = [...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])];
  const todayValue = today();
  const todayAllowed = (!min || todayValue >= min) && (!max || todayValue <= max);
  const label = selected
    ? new Intl.DateTimeFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(selected)
    : t('pickDate');

  const close = useCallback(() => setOpen(false), []);
  const panel = useAnchoredPopover<HTMLDivElement>(open, trigger, close, { align: 'end' });

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  // Escape closes the calendar without also closing the surrounding dialog.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className={`date-field ${open ? 'open' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        id={id}
        type="button"
        autoFocus={autoFocus}
        className={`form-control date-field-trigger ${invalid ? 'is-invalid' : ''} ${selected ? '' : 'is-empty'}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={valueId}
        onClick={() => setOpen((current) => !current)}
        onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node)) setOpen(false); }}
      >
        <i className="bi bi-calendar3" aria-hidden="true" />
        <span className="truncate" id={valueId}>{label}</span>
        <i className="bi bi-chevron-down date-field-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="date-field-panel" id={panelId} ref={panel} popover="manual" onKeyDown={onKeyDown} onBlur={(event) => { const next = event.relatedTarget as Node | null; if (!panel.current?.contains(next) && next !== trigger.current) setOpen(false); }}>
          <div className="date-field-core">
            <DayPicker
              mode="single"
              required
              autoFocus
              selected={selected}
              defaultMonth={selected ?? minDate ?? maxDate}
              onSelect={(date) => date && choose(dateInputValue(date))}
              disabled={disabled}
              locale={language === 'ro' ? ro : enGB}
              weekStartsOn={1}
            />
            {todayAllowed && <div className="date-field-footer"><button type="button" className="btn btn-sm btn-link px-2" onClick={() => choose(todayValue)}>{t('today')}</button></div>}
          </div>
        </div>
      )}
    </div>
  );
}
