#!/usr/bin/env node
// _diagnose-scrapes.mjs — Post-Pass-1 self-check for a discover-restaurants run.
//
// Prints source-by-source completeness, body health (paywall sniff), PICKS
// coverage vs scraped top lists, and Reddit score distribution. Catches:
//   • Scrapes that returned names but no bodies (likely paywall or SPA)
//   • PICKS that omit editorial top-listers (missed famous restaurants)
//   • Reddit valence heuristics that aren't matching upvote reality
//
// Usage: node tools/_diagnose-scrapes.mjs <city-slug>
//        (reads scrapes/<city-slug>/*.json and trips/places/<city-slug>-full.json)
import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const city = process.argv[2];
if (!city) { console.error('Usage: _diagnose-scrapes.mjs <city-slug>'); process.exit(1); }

const SCRAPES = resolve(REPO_ROOT, 'scrapes', city);
const picksPath = resolve(REPO_ROOT, `trips/places/${city}-full.json`);
if (!existsSync(SCRAPES)) { console.error(`No scrapes dir: ${SCRAPES}`); process.exit(2); }

// Auto-discover editorial sources (non-reddit *-raw.json files)
const files = readdirSync(SCRAPES).filter(f => f.endsWith('-raw.json') && !f.startsWith('reddit-'));
const sources = Object.fromEntries(
  files.map(f => [f.replace(/-raw\.json$/, ''), JSON.parse(readFileSync(resolve(SCRAPES, f), 'utf-8'))])
);
const redditFiles = readdirSync(SCRAPES).filter(f => /^reddit-thread-\d+\.json$/.test(f));

console.log(`═══ Editorial source health (${Object.keys(sources).length} files) ═══`);
const paywallRe = /subscribe|sign in to (continue|read)|paywall|subscribers only|for subscribers|please sign in/i;
const thinSources = [];
for (const [key, rows] of Object.entries(sources)) {
  if (!Array.isArray(rows)) { console.log(`  ${key.padEnd(28)} — NOT AN ARRAY`); continue; }
  const total = rows.length;
  if (total === 0) { console.log(`  ${key.padEnd(28)} — EMPTY`); thinSources.push(key); continue; }
  const withBody = rows.filter(r => r.body && r.body.length > 100).length;
  const bodyFrac = total ? withBody / total : 0;
  const avgLen = rows.reduce((a, r) => a + (r.body?.length || 0), 0) / total | 0;
  const paywallHits = rows.filter(r => r.body && paywallRe.test(r.body)).length;
  // Name-only sources (like Michelin list pages) have zero-length bodies by
  // design — the L5 scrape/enrich boundary says "don't drill into detail
  // pages." Flag partial-body scrapes (likely paywalled SPAs) but accept
  // fully-name-only sources.
  const warn = [];
  const isNameOnly = withBody === 0 && /michelin|50best/.test(key);
  if (!isNameOnly && bodyFrac < 0.5 && total > 5) warn.push('⚠ mostly-empty bodies');
  if (paywallHits / Math.max(total, 1) > 0.1) warn.push(`⚠ ${paywallHits} paywall hits`);
  console.log(`  ${key.padEnd(28)} — ${total} entries · bodies ${withBody}/${total} · avg ${avgLen}c${warn.length ? ' · ' + warn.join(', ') : ''}`);
  if (warn.length) thinSources.push(key);
}
console.log(`  Reddit threads:              ${redditFiles.length}`);

// PICKS coverage
if (!existsSync(picksPath)) {
  console.log(`\n⚠ No PICKS file at ${picksPath} — run the normalizer first.`);
  process.exit(0);
}
const picks = JSON.parse(readFileSync(picksPath, 'utf-8'));
console.log(`\n═══ PICKS coverage (${picks.length} total) ═══`);
console.log(`  Reddit-only:  ${picks.filter(p => p.sources.every(s => s.type === 'reddit')).length}`);
console.log(`  ≥2 editorial: ${picks.filter(p => p.sources.filter(s => s.type !== 'reddit').length >= 2).length}`);
console.log(`  ≥3 editorial: ${picks.filter(p => p.sources.filter(s => s.type !== 'reddit').length >= 3).length}`);

function isCovered(name) {
  const s = slugify(name);
  if (picks.some(p => p.id === s)) return true;
  return picks.some(p => [p.name, ...(p.aliases || [])].some(a => slugify(a) === s));
}
const JUNK_RE = /^(how to|where to|best of|the spots|suggested|written by|hit list|consent|privacy|cookie|manage|cookie list)/i;
console.log(`\n═══ Editorial top-listers NOT in PICKS (investigate before finalizing) ═══`);
for (const [key, rows] of Object.entries(sources)) {
  if (!Array.isArray(rows) || !rows.length) continue;
  const cands = rows.filter(r => r.name && !JUNK_RE.test(r.name));
  const missed = cands.filter(r => !isCovered(r.name)).map(r => r.name);
  console.log(`  ${key.padEnd(28)} — ${missed.length}/${cands.length} uncovered`);
  if (missed.length) console.log(`    ${missed.slice(0, 8).join(' | ')}${missed.length > 8 ? ' | …' : ''}`);
}

// Reddit score distribution
const allMatches = [];
for (const p of picks) {
  const r = (p.sources || []).find(s => s.type === 'reddit');
  if (!r) continue;
  for (const sn of (r.snippets || [])) allMatches.push({ name: p.name, score: sn.score, valence: r.valence, text: sn.text });
}
console.log(`\n═══ Reddit signal distribution ═══`);
console.log(`  Total snippet matches: ${allMatches.length}`);
const bins = [0, 5, 10, 15, 20, 30];
for (let i = 0; i < bins.length; i++) {
  const lo = bins[i], hi = bins[i+1] ?? Infinity;
  const n = allMatches.filter(m => m.score >= lo && m.score < hi).length;
  console.log(`    score ${lo}-${hi === Infinity ? '∞' : hi}: ${n}`);
}
const hiHits = allMatches.filter(m => m.score >= 10).sort((a, b) => b.score - a.score);
console.log(`\n═══ High-score (≥10▲) Reddit hits — verify valence labels match sentiment ═══`);
for (const h of hiHits.slice(0, 15)) {
  console.log(`  ${String(h.score).padStart(3)}▲ [${String(h.valence).padEnd(14)}] ${h.name.padEnd(30)} — ${h.text.slice(0, 100).replace(/\n/g, ' ')}`);
}

// ── Place-match audit (catches "Nua masquerading as Restaurant Ki") ──
// Only runs if we can reach Supabase (we're in the repo root with env vars).
try {
  const { selectMany } = await import('./_db.mjs');
  const { verifyNameMatch } = await import('./_places.mjs');
  // Read the group id out of the picks filename convention (no hard link).
  // Caller: pass the group id separately if we want to be strict. For now
  // try every group and see which one matches the picks-file set.
  const groups = await selectMany('groups', {}, 'select=id,name,city_slug');
  const sampleSlug = picks[0]?.id;
  const grp = sampleSlug
    ? (await Promise.all(groups.map(async g => {
        const rows = await selectMany('group_restaurants', { group_id: g.id, restaurant_id: sampleSlug }, 'select=restaurant_id');
        return rows.length ? g : null;
      }))).find(Boolean)
    : null;
  if (grp) {
    const rows = await selectMany('group_restaurants', { group_id: grp.id, status: 'active' }, 'select=restaurant_id,data');
    const mismatches = [];
    for (const r of rows) {
      const d = r.data || {};
      if (!d.placeRaw) continue;
      const m = verifyNameMatch(d.name, d.placeRaw);
      if (!m.ok) mismatches.push({ name: d.name, got: m.gotName, reason: m.reason, addr: d.placeRaw?.formattedAddress });
    }
    console.log(`\n═══ Place-match audit (${grp.name}) — data.name vs placeRaw.displayName ═══`);
    if (mismatches.length === 0) {
      console.log(`  ✓ All ${rows.filter(r => r.data?.placeRaw).length} enriched rows match their intended name.`);
    } else {
      console.log(`  ⚠ ${mismatches.length} row(s) have NAME MISMATCH — the stored Place record is for a different restaurant:`);
      for (const m of mismatches) {
        console.log(`    • ${m.name.padEnd(30)} → got "${m.got}" @ ${m.addr || '?'}`);
      }
      console.log(`  Fix: clear data.placeId, data.placeRaw, data.lat, data.lng, etc. on these rows and re-run enrichment with a better name+address hint (or manually set placeId).`);
    }
  }
} catch (e) {
  // Non-fatal — the diagnostic runs from scrape data alone even without DB.
  console.log(`\n  (Place-match audit skipped — DB unreachable: ${e.message})`);
}

// Verdict
console.log(`\n═══ Verdict ═══`);
if (thinSources.length) {
  console.log(`  ⚠ Thin/paywalled sources: ${thinSources.join(', ')}`);
  console.log(`    Fix: re-scrape with JS rendering, or ask the user to open the URL in a logged-in browser.`);
} else {
  console.log(`  ✓ All editorial sources returned real body text.`);
}
const topPickCount = picks.filter(p => p.sources.some(s => s.type === 'reddit' && s.valence === 'top-pick')).length;
if (hiHits.length >= 5 && topPickCount === 0) {
  console.log(`  ⚠ ${hiHits.length} Reddit comments scored ≥10▲ but no "top-pick" valence assigned — loosen computeValence() heuristic (upvotes ARE sentiment; don't require adjective cues).`);
}
const bigMissSources = Object.entries(sources).filter(([, rows]) => {
  if (!Array.isArray(rows)) return false;
  const cands = rows.filter(r => r.name && !JUNK_RE.test(r.name));
  return cands.length > 10 && cands.filter(r => !isCovered(r.name)).length > cands.length * 0.7;
}).map(([k]) => k);
if (bigMissSources.length) {
  console.log(`  ⚠ <30% of these sources are represented in PICKS: ${bigMissSources.join(', ')}. Consider broadening or confirming intent.`);
}
