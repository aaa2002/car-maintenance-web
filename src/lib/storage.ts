import { supabase } from './supabase';

export const CAR_PHOTO_BUCKET = 'car-photos';
export const CAR_DOCUMENT_BUCKET = 'car-documents';
const SIGNED_URL_TTL = 60 * 60;

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('You must be signed in to upload files.');
  return data.user.id;
}

function safeExtension(file: File, fallback: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension?.match(/^[a-z0-9]+$/) ? extension : fallback;
}

async function upload(bucket: string, folder: string, file: File, fallback: string) {
  const uid = await userId();
  const path = `${uid}/${folder}/${Date.now()}-${crypto.randomUUID()}.${safeExtension(file, fallback)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

export function uploadCarPhoto(file: File) {
  return upload(CAR_PHOTO_BUCKET, 'cars', file, 'jpg');
}

export function uploadComplianceAttachment(file: File) {
  return upload(CAR_DOCUMENT_BUCKET, 'documents', file, 'bin');
}

export async function signedUrl(bucket: string, path: string | null) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  return error ? null : data.signedUrl;
}

export async function signedUrlMap(bucket: string, paths: (string | null)[]) {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, SIGNED_URL_TTL);
  if (!error) data?.forEach((entry) => entry.path && entry.signedUrl && map.set(entry.path, entry.signedUrl));
  return map;
}

export async function removeObject(bucket: string, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(bucket).remove([path]);
}
