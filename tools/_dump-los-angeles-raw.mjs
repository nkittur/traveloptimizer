#!/usr/bin/env node
// Dump composition input (editorial + Google reviews + Reddit snippets) for LA
// picks, used to hand-craft Zagat-style descriptions in Pass 2.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectMany } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const rows = await selectMany('group_restaurants',
  { group_id: 'awwnktte', status: 'active' },
  'select=restaurant_id,data');

const composePath = resolve(REPO_ROOT, 'trips/places/los-angeles-compose-input.json');
const composeIn = JSON.parse(readFileSync(composePath, 'utf-8'));
const composeById = Object.fromEntries(composeIn.map(e => [e.id, e]));

let out = '';
for (const row of rows) {
  const d = row.data;
  const c = composeById[row.restaurant_id] || {};
  out += `\n${'='.repeat(70)}\n`;
  out += `${d.name}  (id=${row.restaurant_id})\n`;
  out += `  cuisine: ${d.cuisine || '?'} | neighborhood: ${d.neighborhood || '?'} | tier: ${d.tier || '?'}\n`;
  out += `  price: ${d.price || '?'} | rating: ${d.googleRating || '?'}★ (${d.googleReviewCount || 0}) | outdoor: ${d.outdoorSeating}\n`;
  out += `  sources: ${(d.sources || []).map(s => s.type + (s.valence ? ':' + s.valence : '')).join(', ')}\n`;
  if (c._rawDescs) {
    for (const [k, v] of Object.entries(c._rawDescs)) {
      if (!v) continue;
      out += `\n  [${k}] ${v.slice(0, 1200)}\n`;
    }
  }
  const reddit = (d.sources || []).find(s => s.type === 'reddit');
  if (reddit?.snippets?.length) {
    out += `\n  [reddit :: ${reddit.valence}]\n`;
    for (const s of reddit.snippets.slice(0, 4)) {
      out += `    ${s.score}▲ — ${s.text.slice(0, 280)}\n`;
    }
  }
  if (d.googleReviews?.length) {
    out += `\n  [google reviews]\n`;
    for (const r of d.googleReviews.slice(0, 4)) {
      out += `    ${r.rating}★ (${r.author}): ${(r.text || '').replace(/\s+/g, ' ').slice(0, 350)}\n`;
    }
  }
}

const dumpPath = resolve(REPO_ROOT, 'trips/places/los-angeles-compose-dump.txt');
writeFileSync(dumpPath, out);
console.log(`Wrote ${dumpPath} (${out.length} chars)`);
