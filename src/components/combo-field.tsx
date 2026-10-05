'use client';

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAnchoredPopover } from './use-anchored-popover';

type ComboFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  invalid?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
};

// Prefix matches first, then matches anywhere; case-insensitive.
function rank(options: string[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const starts = options.filter((option) => option.toLowerCase().startsWith(q));
  const contains = options.filter((option) => !option.toLowerCase().startsWith(q) && option.toLowerCase().includes(q));
  return [...starts, ...contains];
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query.trim() ? text.toLowerCase().indexOf(query.trim().toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  const end = at + query.trim().length;
  return <>{text.slice(0, at)}<mark>{text.slice(at, end)}</mark>{text.slice(end)}</>;
}

/** Free-text input with a styled suggestion list (ARIA combobox, list autocomplete). */
export function ComboField({ id, value, onChange, options, invalid, autoFocus, maxLength }: ComboFieldProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => {
    const ranked = rank(options, value);
    // Nothing to suggest when the field already holds exactly the only match.
    return ranked.length === 1 && ranked[0].toLowerCase() === value.trim().toLowerCase() ? [] : ranked;
  }, [options, value]);
  const showing = open && results.length > 0;

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);
  const panel = useAnchoredPopover<HTMLDivElement>(showing, input, close, { align: 'start', matchWidth: true, layoutKey: results.length });

  function choose(option: string) {
    onChange(option);
    close();
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showing) { setOpen(true); setActive(event.key === 'ArrowDown' ? 0 : results.length - 1); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + results.length) % results.length);
    } else if (event.key === 'Enter' && showing && active >= 0) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape' && showing) {
      // Close the list without also closing the surrounding dialog.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  return (
    <>
      <input
        ref={input}
        id={id}
        className={`form-control ${invalid ? 'is-invalid' : ''}`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onClick={() => setOpen(true)}
        onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node)) close(); }}
        onKeyDown={onKeyDown}
      />
      {showing && (
        <div className="combo-panel" ref={panel} popover="manual">
          <ul className="combo-list" id={listId} role="listbox">
            {results.map((option, index) => (
              <li
                key={option}
                id={`${listId}-${index}`}
                role="option"
                aria-label={option}
                aria-selected={index === active}
                className={`combo-option ${index === active ? 'active' : ''} ${option === value ? 'chosen' : ''}`}
                // Keep focus in the input so typing can continue.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="truncate"><Highlight text={option} query={value} /></span>
                {option === value && <i className="bi bi-check2" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
