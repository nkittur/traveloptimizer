#!/usr/bin/env node
// _normalize-barcelona.mjs — One-off: combines CNT 34 + Time Out 10 + World's 50 Best
// Barcelona entries into a single normalized JSON for upsert. Handles overlap
// detection and source merging.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// 1. Load the CNT raw dump
const cntRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'cnt-barcelona-raw.json'), 'utf-8'));

// Strip HTML entity encoding + common leaked markdown
function unesc(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    // Collapse markdown-style inline links "[text](url)" → "text"
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    // Strip Kramdown link attributes like {: target="_blank"}
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    // Strip any stray markdown emphasis markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // Normalize whitespace (including leaked ones from &nbsp;)
    .replace(/\s+/g, ' ')
    .trim();
}

// 2. Normalize CNT entries
const cnt = cntRaw.map((it, idx) => {
  const name = unesc(it.name);
  // dek is the long review text — highlights = first 2 sentences
  const dek = unesc(it.originalVenue?.dek || '');
  const sentences = dek.match(/[^.!?]+[.!?]+/g) || [dek];
  const highlights = sentences.slice(0, 3).join(' ').trim().slice(0, 500) || null;
  return {
    id: slugify(name),
    name,
    neighborhood: null, // CNT didn't expose neighborhood in our extract
    address: null,
    price: null,
    cuisine: null,
    openFor: null,
    highlights,
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources: [{
      type: 'cnt',
      detail: `Condé Nast Traveler — 34 Best Restaurants in Barcelona`,
      rank: idx + 1,
    }],
  };
});

// 3. The Time Out entries (already normalized in barcelona-test.json)
const timeout = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-test.json'), 'utf-8'));

// 4. World's 50 Best 2025 overlaps + additions
const worldsBest = [
  { name: 'Enigma', rank: 34, detail: 'The World\'s 50 Best Restaurants 2025 #34' },
  { name: 'Cocina Hermanos Torres', rank: 78, detail: 'The World\'s 50 Best Restaurants 2025 #78' },
];

// 5. Fuzzy-match helper — case, accents, punctuation insensitive
function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/['’`"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatch(pool, name) {
  const n = norm(name);
  return pool.find(p => {
    const pn = norm(p.name);
    return pn === n || pn.includes(n) || n.includes(pn);
  });
}

// 6. Merge: start with Time Out, then cross-reference + add CNT entries
const merged = [...timeout];

for (const cntEntry of cnt) {
  const match = findMatch(merged, cntEntry.name);
  if (match) {
    // Merge sources
    match.sources.push(...cntEntry.sources);
    // Prefer the longer highlights if CNT's is more detailed
    if ((cntEntry.highlights?.length || 0) > (match.highlights?.length || 0) * 1.5) {
      match.highlights = cntEntry.highlights;
    }
    continue;
  }
  merged.push(cntEntry);
}

// 7. Add World's 50 Best overlaps
for (const wb of worldsBest) {
  const match = findMatch(merged, wb.name);
  if (match) {
    match.sources.push({ type: '50best', detail: wb.detail, rank: wb.rank });
  } else {
    // Not in either list — insert as a new entry with minimal data
    merged.push({
      id: slugify(wb.name),
      name: wb.name,
      neighborhood: null, address: null, price: null, cuisine: null,
      openFor: null,
      highlights: `Listed on The World's 50 Best Restaurants 2025 (#${wb.rank}).`,
      insiderTip: null, website: null,
      inTargetArea: true, notes: null,
      sources: [{ type: '50best', detail: wb.detail, rank: wb.rank }],
    });
  }
}

// 8. Also note: Disfrutar was #1 in 2024 (mentioned in CNT intro)
const disfrutar = findMatch(merged, 'Disfrutar');
if (disfrutar) {
  disfrutar.sources.push({
    type: '50best',
    detail: 'The World\'s 50 Best Restaurants — #1 in 2024',
    rank: 1,
  });
}

// 9. Dedupe by id (final safety net)
const byId = new Map();
for (const r of merged) {
  if (!byId.has(r.id)) byId.set(r.id, r);
}
const out = Array.from(byId.values());

// 10. Sort: multi-source first (high-credibility signal), then alphabetically
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/barcelona-full.json'), JSON.stringify(out, null, 2));

console.log(`Wrote ${out.length} entries → trips/places/barcelona-full.json`);
console.log(`  Time Out entries:  ${timeout.length}`);
console.log(`  CNT entries:       ${cnt.length}`);
console.log(`  50 Best entries:   ${worldsBest.length}`);
console.log(`  Multi-source:      ${out.filter(r => r.sources.length > 1).length}`);
console.log('\nMulti-source restaurants:');
for (const r of out.filter(r => r.sources.length > 1)) {
  console.log(`  • ${r.name} — ${r.sources.map(s => s.type).join(', ')}`);
}
