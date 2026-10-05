'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useSettings } from './providers';

type Existing = { name: string; url?: string | null };
type FileDropProps = {
  id: string;
  accept: string;
  hint: string;
  file: File | null;
  onFile: (file: File | null) => void;
  invalid?: boolean;
  /** An already-saved file, shown until it is replaced or marked for removal. */
  existing?: Existing | null;
  removed?: boolean;
  onRemovedChange?: (removed: boolean) => void;
  /** Image preview URL; when present the drop zone shows the image instead of the file row. */
  preview?: string | null;
};

const formatSize = (bytes: number, language: 'en' | 'ro') =>
  new Intl.NumberFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { style: 'unit', unit: bytes >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 })
    .format(bytes >= 1024 * 1024 ? bytes / 1024 / 1024 : Math.max(1, bytes / 1024));

// Mirrors the input's accept attribute so dropped files get the same filtering as the picker.
const accepts = (file: File, accept: string) => accept.split(',').map((value) => value.trim()).some((rule) =>
  rule.endsWith('/*') ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule);

export function FileDrop({ id, accept, hint, file, onFile, invalid, existing, removed, onRemovedChange, preview }: FileDropProps) {
  const { t, language } = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [typeError, setTypeError] = useState(false);
  const browse = () => input.current?.click();

  function take(next: File | null) {
    if (next && !accepts(next, accept)) { setTypeError(true); return; }
    setTypeError(false);
    onFile(next);
    if (input.current) input.current.value = '';
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files[0] ?? null);
  }

  const showExisting = !file && existing && !removed;
  const hasContent = Boolean(file || showExisting);
  const isImage = Boolean(preview && hasContent);

  return (
    <div
      className={`file-drop ${dragging ? 'dragging' : ''} ${invalid || typeError ? 'invalid' : ''} ${hasContent ? 'filled' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}
    >
      <input ref={input} id={id} type="file" accept={accept} className="visually-hidden" onChange={(event) => take(event.target.files?.[0] ?? null)} />
      <div className="file-drop-core">
        {isImage && <img src={preview!} alt="" className="file-drop-preview" />}
        {hasContent ? (
          <div className="file-drop-row">
            {!isImage && <span className="row-icon tone-brand"><i className={`bi ${(file?.type ?? '').includes('pdf') || /\.pdf$/i.test(existing?.name ?? '') ? 'bi-file-earmark-pdf' : 'bi-file-earmark-image'}`} /></span>}
            <span className="min-w-0 flex-grow-1">
              {file ? <span className="d-block fw-semibold truncate">{file.name}</span>
                : existing?.url ? <a className="d-block fw-semibold truncate" href={existing.url} target="_blank" rel="noreferrer">{existing.name}</a>
                : <span className="d-block fw-semibold truncate">{existing?.name}</span>}
              <span className="d-block small text-body-secondary">{file ? formatSize(file.size, language) : t('currentFile')}</span>
            </span>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={browse}>{t('replace')}</button>
            <button type="button" className="icon-button danger" onClick={() => (file ? take(null) : onRemovedChange?.(true))} aria-label={t('remove')}><i className="bi bi-x-lg" /></button>
          </div>
        ) : (
          <label htmlFor={id} className="file-drop-empty">
            <span className="file-drop-icon"><i className={`bi ${dragging ? 'bi-download' : 'bi-cloud-arrow-up'}`} /></span>
            <span><span className="fw-semibold">{t('dropFile')} </span><span className="file-drop-browse">{t('browse')}</span></span>
            <span className="small text-body-secondary">{hint}</span>
          </label>
        )}
      </div>
      {removed && !file && existing && (
        <div className="file-drop-note"><span>{t('willBeRemoved')}</span><button type="button" className="btn btn-sm btn-link p-0" onClick={() => onRemovedChange?.(false)}>{t('undo')}</button></div>
      )}
      {typeError && <div className="invalid-feedback">{t('fileTypeError')}</div>}
    </div>
  );
}
