// _storage.mjs — Shared Supabase Storage helpers for photo mirroring.
// Keeps the service-role key in one place and provides bucket-ensure + upload.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SUPABASE_URL } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const BUCKET = 'restaurant-photos';
export const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;
export const PUBLIC_BASE = `${STORAGE_BASE}/object/public/${BUCKET}`;

function loadServiceKey() {
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    try {
      const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
      const m = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
      if (m) key = m[1].trim();
    } catch {}
  }
  if (!key) {
    throw new Error('No SUPABASE_SERVICE_ROLE_KEY in env or .env (Dashboard → Project Settings → API → service_role).');
  }
  return key;
}

export const SERVICE_KEY = loadServiceKey();

export async function ensureBucket() {
  const probe = await fetch(`${STORAGE_BASE}/bucket/${BUCKET}`, {
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
  });
  if (probe.ok) return;
  if (probe.status !== 400 && probe.status !== 404) {
    throw new Error(`bucket probe ${probe.status} ${await probe.text()}`);
  }
  const create = await fetch(`${STORAGE_BASE}/bucket`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 5_000_000,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });
  if (!create.ok) throw new Error(`bucket create ${create.status} ${await create.text()}`);
}

export async function uploadBytes(path, bytes, contentType) {
  const res = await fetch(`${STORAGE_BASE}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${path} → ${res.status} ${await res.text()}`);
  return `${PUBLIC_BASE}/${path}`;
}

// Fetch an image URL and return { bytes, contentType }. Follows redirects.
export async function downloadImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType: ct };
}

export function isGoogleUrl(u) {
  return typeof u === 'string' && /googleapis\.com/.test(u);
}

export function extForContentType(ct) {
  if (/webp/i.test(ct)) return 'webp';
  if (/png/i.test(ct))  return 'png';
  return 'jpg';
}
