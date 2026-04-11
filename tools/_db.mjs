// _db.mjs — Shared Supabase REST helper for CLI tools.
// Reads URL + anon key from webapp/index.html (single source of truth).
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const INDEX_HTML = resolve(REPO_ROOT, 'webapp/index.html');

const html = readFileSync(INDEX_HTML, 'utf-8');
const urlMatch = html.match(/window\.__SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
const keyMatch = html.match(/window\.__SUPABASE_KEY\s*=\s*['"]([^'"]+)['"]/);
if (!urlMatch || !keyMatch) {
  throw new Error('Could not find Supabase URL/key in webapp/index.html');
}
export const SUPABASE_URL = urlMatch[1];
export const SUPABASE_KEY = keyMatch[1];

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export async function pg(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function selectOne(table, filter) {
  const q = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const rows = await pg(`/${table}?${q}&limit=1`);
  return rows?.[0] || null;
}

export async function selectMany(table, filter = {}, extra = '') {
  const parts = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
  if (extra) parts.push(extra);
  const q = parts.join('&');
  return (await pg(`/${table}?${q}`)) || [];
}

export async function insert(table, rowOrRows, { returnRepresentation = false } = {}) {
  const headers = {};
  if (returnRepresentation) headers['Prefer'] = 'return=representation';
  return pg(`/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rowOrRows),
  });
}

export async function upsert(table, rowOrRows, { onConflict }) {
  const path = onConflict ? `/${table}?on_conflict=${onConflict}` : `/${table}`;
  return pg(path, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(rowOrRows),
  });
}

export async function update(table, filter, patch) {
  const q = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  return pg(`/${table}?${q}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function slugify(name) {
  return String(name).toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
