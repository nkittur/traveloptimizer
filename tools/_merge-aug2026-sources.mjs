#!/usr/bin/env node
// _merge-aug2026-sources.mjs — Cross-reference scraped archives against the
// August 2026 trip's destinations and update each destination's sources[]
// with verified entries (real URL, real headline, scraped: true).
//
// Reads:
//   nyt36-archive-raw.json   — full NYT 36 Hours archive (180 articles, ~3.5y)
//   lp-bit-2026-raw.json     — Lonely Planet Best in Travel 2026 top 25
//
// For each finalist + active destination on trip cg7pgj64:
//   - search archives for direct matches (slug → URL/title contains)
//   - search archives for nearby/adjacent matches (e.g., Vancouver-Tofino → "Vancouver")
//   - rebuild sources[] with verified-first ordering
//
// Run:
//   node tools/_merge-aug2026-sources.mjs

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectMany, pg } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TRIP = 'cg7pgj64';

function readMaybeDoubleEncoded(path) {
  const raw = readFileSync(path, 'utf-8');
  const first = JSON.parse(raw);
  return typeof first === 'string' ? JSON.parse(first) : first;
}
const nyt  = readMaybeDoubleEncoded(resolve(REPO_ROOT, 'nyt36-archive-raw.json'));
const lp   = readMaybeDoubleEncoded(resolve(REPO_ROOT, 'lp-bit-2026-raw.json'));
const cnt  = readMaybeDoubleEncoded(resolve(REPO_ROOT, 'cnt-bestof-2026-raw.json'));
const tl   = readMaybeDoubleEncoded(resolve(REPO_ROOT, 'tl-50best-2026-raw.json'));
const afar = readMaybeDoubleEncoded(resolve(REPO_ROOT, 'afar-bestof-2026-raw.json'));

// ── Per-destination archive-match rules ──
// `slug` → { nyt: [keyword(s) that must appear in URL or headline],
//            lp:  [array of LP destination names that count as a match],
//            cnt: [array of CNT 2026 names — global/europe/us — that count as a match],
//            tl:  [array of T+L 2026 names that count as a match],
//            afar:[array of AFAR 2026 names that count as a match],
//            extras: [hand-curated additional sources to keep]
//          }
const RULES = {
  'reykjavik-iceland': {
    nyt: ['reykjavik'],
    lp:  ['Finland'],
    cnt: ['Oulu, Finland'],                    // adjacent Nordic
    tl:  ['Reykjavík, Iceland'],               // direct
    afar:['Oulu, Finland'],                    // adjacent Nordic
    extras: [
      { type: 'cntraveler',   url: 'https://www.cntraveler.com/destinations/iceland', title: 'CN Traveler — Iceland (destination guide)', verified: false },
    ],
  },
  'lisbon-portugal': {
    nyt: ['lisbon'],
    lp:  [],
    cnt: [],
    tl:  [],
    afar:[],
    extras: [
      { type: 'nyt36hours-recent', url: 'https://www.nytimes.com/interactive/2024/05/09/travel/things-to-do-lisbon.html', title: '36 Hours in Lisbon (2024)', verified: false },
      { type: 'cntraveler',  url: 'https://www.cntraveler.com/destinations/lisbon', title: 'CN Traveler — Lisbon (destination guide)',  verified: false },
    ],
  },
  'quebec-city-canada': {
    nyt: ['quebec-city'],
    lp:  ['British Columbia'],
    cnt: ['Prince Edward County, Canada'],     // adjacent Canadian
    tl:  [],
    afar:[],
    extras: [],
  },
  'montreal-canada': {
    nyt: ['montreal'],
    lp:  ['British Columbia'],
    cnt: ['Prince Edward County, Canada'],
    tl:  [],
    afar:[],
    extras: [
      { type: 'eater', url: 'https://montreal.eater.com/maps/best-restaurants-montreal', title: 'Eater Montreal — Best Restaurants', verified: false },
    ],
  },
  'vancouver-tofino': {
    nyt: ['vancouver'],
    lp:  ['British Columbia'],
    cnt: [],
    tl:  ['Alberta'],                          // adjacent Canadian Rockies
    afar:[],
    extras: [],
  },
  'acadia-maine': {
    nyt: ['portland-maine'],
    lp:  ['Maine'],
    cnt: ['Boston'],                           // closest CNT US 2026 to Maine
    tl:  [],
    afar:[],
    extras: [],
  },
  'marthas-vineyard': {
    nyt: ['marthas-vineyard', 'nantucket'],
    lp:  [],
    cnt: ['Boston'],                           // adjacent New England
    tl:  [],
    afar:[],
    extras: [],
  },
  'copenhagen-denmark': {
    nyt: ['copenhagen', 'malmo'],
    lp:  [],
    cnt: ['Oulu, Finland'],
    tl:  [],
    afar:['Stockholm Archipelago, Sweden'],    // adjacent Scandi
    extras: [
      { type: 'nyt36hours-recent', url: 'https://www.nytimes.com/2024/09/05/travel/things-to-do-copenhagen.html', title: '36 Hours in Copenhagen (2024)', verified: false },
    ],
  },
  'stockholm-sweden': {
    nyt: ['malmo'],
    lp:  ['Finland'],
    cnt: ['Oulu, Finland'],
    tl:  ['Oulu, Finland'],
    afar:['Stockholm Archipelago, Sweden'],    // direct
    extras: [],
  },
  'bergen-fjords-norway': {
    nyt: ['oslo'],
    lp:  [],
    cnt: [],
    tl:  [],
    afar:[],
    extras: [
      { type: 'lonelyplanet', url: 'https://www.lonelyplanet.com/norway/bergen', title: 'Lonely Planet — Bergen (destination guide)', verified: false },
      { type: 'natgeo',       url: 'https://www.nationalgeographic.com/travel/article/best-things-to-do-norway-fjords', title: 'NatGeo — Norway Fjords', verified: false },
    ],
  },
  'banff-canada': {
    nyt: ['banff'],
    lp:  ['British Columbia'],
    cnt: [],
    tl:  ['Alberta'],                          // direct (Banff is in Alberta)
    afar:[],
    extras: [
      { type: 'natgeo', url: 'https://www.nationalgeographic.com/travel/national-parks/article/banff-national-park', title: 'NatGeo — Banff National Park', verified: false },
    ],
  },
  'halifax-cape-breton': {
    nyt: [],
    lp:  ['British Columbia'],
    cnt: ['Prince Edward County, Canada'],     // adjacent Atlantic-Canadian
    tl:  [],
    afar:['West Cork, Ireland'],               // adjacent Atlantic-coast village
    extras: [
      { type: 'nyt36hours-archived', url: 'https://www.nytimes.com/2016/08/04/travel/what-to-do-in-36-hours-in-halifax-nova-scotia.html', title: '36 Hours in Halifax (2016)', verified: false },
    ],
  },
};

// Build lookup maps
const nytBySlug = {};        // slug-token → list of {url, headline}
for (const a of nyt) {
  // URL suffix is the destination slug fragment
  const m = a.url.match(/things-to-do-([^.]+)\.html/);
  const fragment = (m ? m[1] : a.headline).toLowerCase();
  // index by every keyword fragment
  fragment.split(/[-_]/).forEach(tok => {
    if (!tok || tok.length < 3) return;
    (nytBySlug[tok] ||= []).push(a);
  });
}

function findNyt(keyword) {
  // Find articles whose URL slug contains the keyword
  const out = [];
  const seen = new Set();
  for (const a of nyt) {
    const url = a.url.toLowerCase();
    if (url.includes(keyword.toLowerCase()) && !seen.has(a.url)) {
      out.push(a); seen.add(a.url);
    }
  }
  // Sort newest-first by URL date prefix
  return out.sort((x, y) => y.url.localeCompare(x.url));
}

function findLp(name) {
  return lp.destinations_25.find(d => d.name.toLowerCase() === name.toLowerCase());
}

function findCnt(name) {
  // Search across global/europe/us lists
  for (const list of ['global', 'europe', 'us']) {
    const dests = cnt[list]?.destinations || [];
    const hit = dests.find(d => d.toLowerCase() === name.toLowerCase());
    if (hit) return { name: hit, list, url: cnt[list]._url };
  }
  return null;
}

function findTl(name) {
  for (const [cat, dests] of Object.entries(tl.by_category)) {
    const hit = (dests || []).find(d => d.toLowerCase() === name.toLowerCase());
    if (hit) return { name: hit, category: cat, url: tl._url };
  }
  return null;
}

function findAfar(name) {
  const hit = afar.destinations.find(d => d.toLowerCase() === name.toLowerCase());
  return hit ? { name: hit, url: afar._url } : null;
}

const dests = await selectMany('trip_destinations', { trip_id: TRIP },
  'select=id,slug,name,sources&status=in.(candidate,active,finalist)');

console.log(`Trip: aug 2026 (${TRIP}) — ${dests.length} destinations`);

let updated = 0, untouched = 0;

for (const d of dests) {
  const rule = RULES[d.slug];
  if (!rule) {
    untouched++;
    process.stderr.write(`  · ${d.slug} — no rule, leaving sources untouched\n`);
    continue;
  }

  const verified = [];

  // NYT matches
  for (const kw of rule.nyt) {
    for (const a of findNyt(kw)) {
      verified.push({
        type: 'nyt36hours',
        url: a.url,
        title: a.headline,
        verified: true,
        match: kw === d.slug.split('-')[0] ? 'direct' : 'adjacent',
      });
    }
  }

  // LP BIT 2026 matches
  for (const lpName of rule.lp) {
    const m = findLp(lpName);
    if (!m) continue;
    verified.push({
      type: 'lonelyplanet-bit2026',
      url: 'https://www.lonelyplanet.com/best-in-travel',
      title: `Lonely Planet Best in Travel 2026 — ${m.name} #${m.rank}`,
      verified: true,
      match: lpName === d.name || d.slug.includes(lpName.toLowerCase()) ? 'direct' : 'adjacent',
    });
  }

  // CNT 2026 matches (global / europe / us)
  for (const cntName of (rule.cnt || [])) {
    const m = findCnt(cntName);
    if (!m) continue;
    verified.push({
      type: 'cntraveler-bestof2026',
      url: m.url,
      title: `Condé Nast Traveler — Best Places to Go in 2026 (${m.list}) — ${m.name}`,
      verified: true,
      match: cntName.toLowerCase() === d.name.toLowerCase() ? 'direct' : 'adjacent',
    });
  }

  // T+L 50 Best 2026 matches
  for (const tlName of (rule.tl || [])) {
    const m = findTl(tlName);
    if (!m) continue;
    verified.push({
      type: 'travelandleisure-50best2026',
      url: m.url,
      title: `Travel + Leisure — 50 Best Places to Travel 2026 (${m.category.replace(/_/g,' ')}) — ${m.name}`,
      verified: true,
      match: tlName.toLowerCase() === d.name.toLowerCase() ? 'direct' : 'adjacent',
    });
  }

  // AFAR 2026 matches
  for (const afarName of (rule.afar || [])) {
    const m = findAfar(afarName);
    if (!m) continue;
    verified.push({
      type: 'afar-bestof2026',
      url: m.url,
      title: `AFAR — Where to Go in 2026 — ${m.name}`,
      verified: true,
      match: afarName.toLowerCase() === d.name.toLowerCase() ? 'direct' : 'adjacent',
    });
  }

  // Extras (curated, not scrape-verified)
  const extras = (rule.extras || []).map(e => ({ ...e, verified: false }));

  const newSources = [...verified, ...extras];
  await pg(`/trip_destinations?id=eq.${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ sources: newSources }),
  });
  updated++;
  process.stderr.write(`  ✓ ${d.slug} → ${verified.length} verified + ${extras.length} curated\n`);
}

console.log(`\n✓ Updated: ${updated}  Untouched: ${untouched}`);
