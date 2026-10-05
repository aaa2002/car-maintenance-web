'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Car, CarInput } from '@/lib/database';
import { carMakes, modelsForMake } from '@/lib/car-catalog';
import { errorMessage } from '@/lib/format';
import { CAR_PHOTO_BUCKET, removeObject, uploadCarPhoto } from '@/lib/storage';
import { useSettings } from './providers';
import { Modal } from './ui';

type Errors = Partial<Record<'brand' | 'model' | 'year' | 'mileage' | 'photo', string>>;

export function VehicleForm({ show, car, onClose, onSave }: { show: boolean; car?: Car | null; onClose: () => void; onSave: (input: CarInput) => Promise<void> }) {
  const { t } = useSettings();
  const [brand, setBrand] = useState(''); const [model, setModel] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear())); const [mileage, setMileage] = useState('');
  const [description, setDescription] = useState(''); const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null); const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!show) return;
    setBrand(car?.brand ?? ''); setModel(car?.model ?? ''); setYear(String(car?.year ?? new Date().getFullYear()));
    setMileage(car?.mileageKm?.toString() ?? ''); setDescription(car?.description ?? ''); setPhoto(null);
    setPreview(car?.photoUrl ?? null); setRemovePhoto(false); setErrors({}); setFormError('');
  }, [show, car]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function pickPhoto(file: File | null) {
    setPhoto(file); setRemovePhoto(false); setErrors((current) => ({ ...current, photo: undefined }));
    if (!file) setPreview(car?.photoUrl ?? null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const parsedYear = Number(year); const parsedMileage = mileage === '' ? null : Number(mileage); const nextErrors: Errors = {};
    if (!brand.trim()) nextErrors.brand = t('requiredFields');
    if (!model.trim()) nextErrors.model = t('requiredFields');
    if (!Number.isInteger(parsedYear) || parsedYear < 1886 || parsedYear > new Date().getFullYear() + 1) nextErrors.year = `1886–${new Date().getFullYear() + 1}`;
    if (parsedMileage !== null && (!Number.isFinite(parsedMileage) || parsedMileage < 0)) nextErrors.mileage = t('invalidNumber');
    if (photo && photo.size > 10 * 1024 * 1024) nextErrors.photo = t('imageSizeError');
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;

    setBusy(true); let photoPath = removePhoto ? null : car?.photoPath ?? null; let uploaded: string | null = null;
    try {
      if (photo) { uploaded = await uploadCarPhoto(photo); photoPath = uploaded; }
      await onSave({ brand, model, year: parsedYear, description: description || null, mileageKm: parsedMileage, photoPath });
      onClose();
    } catch (caught) {
      if (uploaded) await removeObject(CAR_PHOTO_BUCKET, uploaded);
      setFormError(errorMessage(caught, t));
    } finally { setBusy(false); }
  }

  return <Modal title={car ? t('editVehicle') : t('addVehicle')} show={show} onClose={onClose} size="lg"><form onSubmit={submit} noValidate>
    <div className="modal-body"><div className="row g-3">
      <div className="col-12">
        <label className="form-label" htmlFor="vehicle-photo">{t('photo')}</label>
        {preview && !removePhoto && <img src={preview} alt="Vehicle preview" className="vehicle-photo rounded mb-2" style={{ aspectRatio: '16 / 7' }} />}
        <input id="vehicle-photo" className={`form-control ${errors.photo ? 'is-invalid' : ''}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => pickPhoto(event.target.files?.[0] ?? null)} />
        {errors.photo ? <div className="invalid-feedback">{errors.photo}</div> : <div className="form-text">{t('uploadHint')}</div>}
        {car?.photoPath && !photo && <div className="form-check mt-2"><input id="remove-car-photo" type="checkbox" className="form-check-input" checked={removePhoto} onChange={(event) => { setRemovePhoto(event.target.checked); setPreview(event.target.checked ? null : car.photoUrl); }} /><label htmlFor="remove-car-photo" className="form-check-label">{t('removePhoto')}</label></div>}
      </div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="vehicle-brand">{t('brand')}</label><input id="vehicle-brand" autoFocus list="vehicle-makes" autoComplete="off" className={`form-control ${errors.brand ? 'is-invalid' : ''}`} value={brand} maxLength={80} onChange={(event) => setBrand(event.target.value)} /><datalist id="vehicle-makes">{carMakes.map((make) => <option value={make} key={make} />)}</datalist>{errors.brand && <div className="invalid-feedback">{errors.brand}</div>}</div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="vehicle-model">{t('model')}</label><input id="vehicle-model" list="vehicle-models" autoComplete="off" className={`form-control ${errors.model ? 'is-invalid' : ''}`} value={model} maxLength={80} onChange={(event) => setModel(event.target.value)} /><datalist id="vehicle-models">{modelsForMake(brand).map((value) => <option value={value} key={value} />)}</datalist>{errors.model && <div className="invalid-feedback">{errors.model}</div>}</div>
      <div className="col-sm-6"><label className="form-label required" htmlFor="vehicle-year">{t('year')}</label><input id="vehicle-year" inputMode="numeric" type="number" min="1886" max={new Date().getFullYear() + 1} className={`form-control ${errors.year ? 'is-invalid' : ''}`} value={year} onChange={(event) => setYear(event.target.value)} />{errors.year && <div className="invalid-feedback">{errors.year}</div>}</div>
      <div className="col-sm-6"><label className="form-label" htmlFor="vehicle-mileage">{t('mileage')} (km)</label><input id="vehicle-mileage" inputMode="numeric" type="number" min="0" step="1" className={`form-control ${errors.mileage ? 'is-invalid' : ''}`} value={mileage} onChange={(event) => setMileage(event.target.value)} />{errors.mileage && <div className="invalid-feedback">{errors.mileage}</div>}</div>
      <div className="col-12"><label className="form-label" htmlFor="vehicle-description">{t('description')}</label><textarea id="vehicle-description" className="form-control" rows={3} maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} /><div className="form-text text-end">{description.length}/240</div></div>
      {formError && <div className="col-12"><div className="app-alert mb-0" role="alert">{formError}</div></div>}
    </div></div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{t('save')}</button></div>
  </form></Modal>;
}
