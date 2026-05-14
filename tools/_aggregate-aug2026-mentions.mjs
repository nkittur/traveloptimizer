#!/usr/bin/env node
// _aggregate-aug2026-mentions.mjs
// Reads <destination-slug>-<source>-raw.json files, builds a per-destination
// mentions index keyed by place name, with cross-source counts + category
// inference. Output: <destination-slug>-mentions.json.
//
// Run: node tools/_aggregate-aug2026-mentions.mjs

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// All slugs we may have scraped articles for. Aggregator emits a mentions file
// per slug that has any matching raw files; the recompose step decides what to do
// with non-finalists.
const FINALISTS = [
  'reykjavik-iceland',
  'copenhagen-denmark',
  'quebec-city-canada',
  'vancouver-tofino',
  'acadia-maine',
  'stockholm-sweden',
  'hamptons-newyork',
  'san-diego-california',
  'marthas-vineyard',
  'lisbon-portugal',
  'slovenia-bled-ljubljana',
  'costa-brava-spain',
  'cortina-italy',
  'newport-rhode-island',
  'banff-canada',
  'montreal-canada',
];

function readMaybeDoubleEncoded(path) {
  const raw = readFileSync(path, 'utf-8');
  const first = JSON.parse(raw);
  return typeof first === 'string' ? JSON.parse(first) : first;
}

function inferCategory(snippet, place) {
  const s = (snippet || '').toLowerCase();
  const p = (place || '').toLowerCase();
  const has = (re) => re.test(s) || re.test(p);
  // Order matters — most specific first.
  if (has(/\bhotel\b|guesthouse|hostel|\binn\b|lodge|b&b|riad|ryokan|villa|cabin|resort/)) return 'hotel';
  if (has(/\bbar\b|cocktail|wine bar|pub\b|brewery|brewpub|tap room/)) return 'bar';
  if (has(/café|\bcafe\b|coffee|espresso|roaster|bakery|patisserie/)) return 'cafe';
  if (has(/restaurant|diner|bistro|tavern|brasserie|chef|menu|tasting|street food|cuisine|dining|izakaya|trattoria|seafood|sushi|ramen|barbecue|smokehouse|grill|kitchen/)) return 'restaurant';
  if (has(/museum|gallery|exhibition/)) return 'museum';
  if (has(/\bpark\b|garden|beach|coast|trail|hike|forest|fjord|mountain|\bisland\b|lake|river|harbor|cove|peninsula|cliff|view|overlook|sunset|nature|wildlife|lighthouse/)) return 'park';
  if (has(/church|cathedral|mosque|temple|shrine|chapel|basilica|monument|landmark/)) return 'landmark';
  if (has(/\bshop\b|store|boutique|market|bookstore|record/)) return 'shop';
  return 'sight';
}

function isStop(place, destName) {
  const p = place.toLowerCase().trim();
  const dnTokens = destName.toLowerCase().split(/[\s,]+/).filter(t => t.length > 2);
  // Drop if equals destination name or includes a destination-name token alone
  if (dnTokens.includes(p)) return true;
  // Drop sentence-fragment artifacts (extracted bolds that aren't real place names)
  // E.g., "Note that funicular trams in Lisbon are currently closed,"
  if (/^(note that|please|don't|do not|here|see|check|book|when|while|after|before|during|because|since|though|although|despite|in|at|on|for|with|to|from|following|featuring|including|featuring|across|over|under|via|using)\b/i.test(p)) return true;
  // Real place names start with an uppercase letter (Latin/Greek/Cyrillic).
  // Filter out sentence-fragment artifacts that start lowercase (e.g., "following a fatal crash").
  if (place && /^[a-z]/.test(place.replace(/^\s+/, ''))) return true;
  if (/[,;:]$/.test(p)) return true;                          // trailing punctuation = sentence fragment
  if (/\b(closed|open|hours|reservation|advance|warning|currently|recently|previously|temporarily)\b/i.test(p)) return true;
  if (p.split(' ').length > 8) return true;                   // too wordy = probably a sentence fragment
  // Drop generic words
  const stopwords = new Set(['the river','downtown','old town','the harbor','the bay','the pool','the city','the village','here','this','that','today','tomorrow','sunday','monday','tuesday','wednesday','thursday','friday','saturday','morning','afternoon','evening','night','breakfast','lunch','dinner','tour','visit','tip','note']);
  if (stopwords.has(p)) return true;
  // Drop if too short or has no proper-noun start
  if (p.length < 3 || p.length > 70) return true;
  if (!/[a-z]/i.test(place)) return true;                     // no letters = junk
  return false;
}

// Accept any per-destination raw scrape: <slug>-<source>[-suffix]-raw.json
// where <source> is any short alphanumeric token (nyt36hours, cntraveler, afar,
// lonelyplanet, tl, natgeo, downeast, eater, etc.).
const allFiles = readdirSync(REPO_ROOT).filter(f => /^[a-z][a-z0-9-]+-[a-z][a-z0-9]+(-[a-z0-9]+)?-raw\.json$/.test(f) && !f.includes('-archive-raw') && !f.includes('-bestof-') && !f.includes('-50best-') && !f.includes('-bit-') && !f.includes('-snapshot') && !f.includes('reddit-'));

const summary = [];

for (const destSlug of FINALISTS) {
  // Find all raw files for this destination
  const files = allFiles.filter(f => f.startsWith(destSlug + '-'));
  if (!files.length) {
    summary.push({ destSlug, files: 0, mentions: 0, error: 'no raw files found' });
    continue;
  }
  const mentions = {};
  for (const file of files) {
    // Source type from filename: <slug>-<source>(-suffix)?-raw.json
    const m = file.replace(`${destSlug}-`, '').replace(/-raw\.json$/, '');
    const source = m.split('-')[0]; // first token = source identifier
    const data = readMaybeDoubleEncoded(resolve(REPO_ROOT, file));
    for (const item of (data.items || [])) {
      const place = item.place;
      if (!place || isStop(place, destSlug.replace(/-/g, ' '))) continue;
      const key = place.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!mentions[key]) {
        mentions[key] = {
          display: place,
          count: 0,
          sources: [],
          snippets: [],
          sections: [],
          category: inferCategory(item.snippet, place),
        };
      }
      const m = mentions[key];
      m.count++;
      if (!m.sources.includes(source)) m.sources.push(source);
      if (item.snippet) m.snippets.push({ source, text: item.snippet });
      if (item.section) m.sections.push(item.section);
      // Re-infer category if a richer snippet provides a clearer signal
      const reinferred = inferCategory(item.snippet, place);
      if (reinferred !== 'sight' && m.category === 'sight') m.category = reinferred;
    }
  }

  // Sort mentions by count desc, then by snippet richness
  const ranked = Object.values(mentions).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.snippets.length || 0) - (a.snippets.length || 0);
  });

  const outPath = resolve(REPO_ROOT, `${destSlug}-mentions.json`);
  writeFileSync(outPath, JSON.stringify({
    destination: destSlug,
    sources_drilled: [...new Set(files.map(f => {
      const m = f.replace(`${destSlug}-`, '').replace(/-raw\.json$/, '');
      return m.split('-')[0];
    }))],
    mentions: ranked,
  }, null, 2));

  // Summary stats
  const byCat = {};
  for (const r of ranked) byCat[r.category] = (byCat[r.category] || 0) + 1;
  summary.push({ destSlug, files: files.length, mentions: ranked.length, byCat });
  console.log(`✓ ${destSlug}: ${files.length} files → ${ranked.length} unique mentions`);
  console.log(`    Categories: ${Object.entries(byCat).map(([k,v]) => `${k}:${v}`).join(', ')}`);
  console.log(`    Top 5: ${ranked.slice(0, 5).map(r => `${r.display} (${r.category})`).join('; ')}`);
}

console.log('\nWritten: <destination-slug>-mentions.json for each finalist.');
