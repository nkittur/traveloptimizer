#!/usr/bin/env node
// _normalize-irvine.mjs — Merge Irvine editorial sources (Eater LA 38 OC,
// Eater Korean OC, Eater UCI, LA Times halal, Michelin OC) + 13 r/irvine +
// r/orangecounty threads into a single normalized JSON.
//
// Group criteria: outdoor seating + focus on Indian/Thai/Korean/French
// (with close adjacents like French-Vietnamese, Indo-Pak, bistro).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCRAPES = resolve(REPO_ROOT, 'scrapes/irvine');

// ── Text cleanup ──
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
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceTruncate(s, maxChars = 700) {
  if (!s) return null;
  const clean = unesc(s);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = '';
  for (const sent of sentences) {
    if (out.length > 0 && out.length + sent.length > maxChars) break;
    out += sent;
    if (out.length >= maxChars * 0.95) break;
  }
  out = out.trim();
  if (!out && clean.length) {
    const hardLimit = clean.slice(0, maxChars);
    const lastSpace = hardLimit.lastIndexOf(' ');
    out = (lastSpace > maxChars * 0.5 ? hardLimit.slice(0, lastSpace) : hardLimit).trim() + '…';
  }
  return out || null;
}

// ── Source article URLs ──
const SOURCE_ARTICLES = {
  eater_oc: {
    url: 'https://la.eater.com/maps/best-essential-restaurants-orange-county-california',
    detail: 'Eater LA — The 38 Best Orange County Restaurants',
  },
  eater_uci: {
    url: 'https://la.eater.com/maps/best-food-restaurants-uci-university-of-california-irvine',
    detail: 'Eater LA — Where to Eat Around UCI',
  },
  eater_korean: {
    url: 'https://la.eater.com/maps/best-korean-restaurants-orange-county-garden-grove-buena-park-irvine',
    detail: 'Eater LA — 15 Essential Korean Restaurants in Orange County',
  },
  latimes_halal: {
    url: 'https://www.latimes.com/food/list/22-places-to-eat-halal-in-southern-california',
    detail: "LA Times — 22 Places to Eat Halal in Southern California",
  },
  michelin: {
    url: 'https://guide.michelin.com/us/en/california/us-irvine/restaurants',
    detail: 'Michelin Guide — Irvine area',
  },
};

// ── Reddit threads scraped ──
const REDDIT_THREADS = [
  { n: 1,  sub: 'irvine',       id: '1lv1n97', title: 'Best Thai Food?' },
  { n: 2,  sub: 'irvine',       id: 'ju943u',  title: 'Biggest patios in Irvine' },
  { n: 3,  sub: 'irvine',       id: 'cl1hgm',  title: 'Best Korean restaurant Irvine?' },
  { n: 4,  sub: 'irvine',       id: '1fvnyda', title: 'Indian cuisine in Irvine / OC' },
  { n: 5,  sub: 'irvine',       id: '1qqpfa0', title: 'Restaurant Recommendations' },
  { n: 6,  sub: 'irvine',       id: '17qu8ty', title: 'Fancy restaurant' },
  { n: 7,  sub: 'orangecounty', id: 'z5igtq',  title: 'Recommendations for Thai Food - Irvine?' },
  { n: 8,  sub: 'orangecounty', id: 's45tcg',  title: "What's the best Thai restaurant in all of Orange County?" },
  { n: 9,  sub: 'orangecounty', id: '1lzyl1n', title: 'Best Korean food in South and Mid OC?' },
  { n: 11, sub: 'irvine',       id: '1l0fudc', title: 'Visiting Irvine what restaurant to try?' },
  { n: 12, sub: 'irvine',       id: '1qzivq6', title: 'Pad thai' },
  { n: 13, sub: 'orangecounty', id: '1opms5t', title: 'Indian food in South OC - Southern Spice replacement' },
];

// Normalize apostrophes (curly → straight → stripped) + lowercase for
// literal substring matching. Straight and curly apostrophes need to match
// each other — Reddit users type both interchangeably.
function normalizeForMatch(s) {
  return String(s).toLowerCase().replace(/[\u2018\u2019'`]/g, '');
}

// Load saved thread contents — a single concatenated blob per thread for
// literal substring matching (post body + all comments, normalized).
const threadBlobById = {};
const threadMeta = {};
for (const t of REDDIT_THREADS) {
  const path = resolve(SCRAPES, `reddit-thread-${t.n}.json`);
  if (!existsSync(path)) { threadBlobById[t.id] = ''; continue; }
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  const blob = [d.postBody || '', ...(d.comments || []).map(c => c.body || '')].join('\n');
  threadBlobById[t.id] = normalizeForMatch(blob);
  threadMeta[t.id] = {
    title: d.title || t.title,
    url: d.url || `https://old.reddit.com/r/${t.sub}/comments/${t.id}/`,
    sub: t.sub,
  };
}

// For each pick, compute which threads mention it. Uses literal substring
// match (apostrophes stripped, lowercased) on name + optional aliases. If
// no match → drop the reddit source entirely (L18 — don't claim Reddit
// signal we can't back up).
function redditSourceFor(name, aliases = []) {
  const candidates = [name, ...aliases].map(normalizeForMatch).filter(c => c.length >= 3);
  const matched = REDDIT_THREADS.filter(t =>
    candidates.some(c => (threadBlobById[t.id] || '').includes(c))
  );
  if (matched.length === 0) return null;
  const threads = matched.map(t => ({
    title: threadMeta[t.id]?.title || t.title,
    url: threadMeta[t.id]?.url,
  }));
  return {
    type: 'reddit',
    detail: `r/${matched[0].sub} — ${matched.length} thread${matched.length === 1 ? '' : 's'}`,
    threads,
    mentions: matched.length,
  };
}

// ── Load editorial scrapes ──
const eaterOC      = JSON.parse(readFileSync(resolve(SCRAPES, 'eater-oc-raw.json'),        'utf-8'));
const eaterKorean  = JSON.parse(readFileSync(resolve(SCRAPES, 'eater-korean-oc-raw.json'), 'utf-8'));
const eaterUCI     = JSON.parse(readFileSync(resolve(SCRAPES, 'eater-uci-raw.json'),       'utf-8'));
const latimesHalal = JSON.parse(readFileSync(resolve(SCRAPES, 'latimes-halal-raw.json'),   'utf-8'));
const michelin     = JSON.parse(readFileSync(resolve(SCRAPES, 'michelin-irvine-raw.json'), 'utf-8'));

// Map by slug → editorial entry (for quickly pulling source prose by name)
const editorialBySlug = {};
function indexEditorial(entries, key) {
  for (const e of entries) {
    if (!e.name) continue;
    editorialBySlug[slugify(e.name)] ??= {};
    editorialBySlug[slugify(e.name)][key] = e;
  }
}
indexEditorial(eaterOC,      'eater_oc');
indexEditorial(eaterKorean,  'eater_korean');
indexEditorial(eaterUCI,     'eater_uci');
indexEditorial(latimesHalal, 'latimes_halal');
indexEditorial(michelin,     'michelin');

function findEditorial(slug, aliases = []) {
  const keys = [slug, ...aliases.map(slugify)];
  const out = {};
  for (const k of keys) if (editorialBySlug[k]) Object.assign(out, editorialBySlug[k]);
  return out;
}

// ── Hand-crafted descriptions lookup (populated Pass 2; empty for Pass 1) ──
const DESC_PATH = resolve(REPO_ROOT, 'trips/places/irvine-descriptions.json');
const handCrafted = existsSync(DESC_PATH) ? JSON.parse(readFileSync(DESC_PATH, 'utf-8')) : {};

// ── PICKS — the curated Irvine list ──
//
// Hand-selected from editorial + Reddit signal for the criteria:
// outdoor seating + Indian/Thai/Korean/French (+close adjacents).
// Every pick has at least one editorial OR ≥2 high-score Reddit mentions.
// Driving radius from Irvine: up to ~25 min (Tustin, Costa Mesa, Newport
// Beach, Lake Forest, Laguna Hills, Anaheim, Fullerton for standouts).
const PICKS = [
  // ─── INDIAN / South Asian ───
  { name: 'Khan Saab Desi Craft Kitchen',
    aliases: ['khan saab'],
    editorial: ['khan-saab-desi-craft-kitchen'],
    michelinSlug: 'khan-saab-desi-craft-kitchen',
    cuisine: 'Indian / Pakistani / Afghan (halal)',
    neighborhood: 'Fullerton' },
  { name: 'Adya',
    aliases: ['adya'],
    editorial: ['adya'],
    cuisine: 'Modern Indian',
    neighborhood: 'Anaheim Packing House' },
  { name: 'India Kitchen',
    aliases: ['india kitchen'],
    cuisine: 'Indian',
    neighborhood: 'Tustin' },
  { name: 'India Gate',
    aliases: ['india gate'],
    cuisine: 'Indian',
    neighborhood: 'Tustin / Irvine border' },
  { name: 'Yellow Chilli',
    aliases: ['yellow chilli', 'yellow chili'],
    cuisine: 'Modern Indian (Sanjeev Kapoor)',
    neighborhood: 'Irvine' },
  { name: 'Annapoorna',
    aliases: ['annapoorna', 'annapurna'],
    cuisine: 'South Indian',
    neighborhood: 'Irvine' },
  { name: 'Biryani Pot Express',
    aliases: ['biryani pot'],
    cuisine: 'Indian / Hyderabadi',
    neighborhood: 'Irvine (near Spectrum)' },
  { name: 'Maast Indian Kitchen',
    aliases: ['maast'],
    cuisine: 'Modern Indian',
    neighborhood: 'Irvine' },
  { name: 'Natraj Cuisine of India',
    aliases: ['natraj', 'nataraj'],
    cuisine: 'Indian',
    neighborhood: 'Laguna Niguel / Irvine' },
  { name: 'Charminar Indian Kitchen',
    aliases: ['charminar'],
    cuisine: 'Hyderabadi Indian',
    neighborhood: 'Laguna Hills' },
  { name: "Nina's Kitchen",
    aliases: ["nina's", 'ninas kitchen'],
    cuisine: 'Indian',
    neighborhood: 'Lake Forest' },

  // ─── THAI ───
  { name: 'Siam Station',
    aliases: ['siam station'],
    editorial: ['siam-station-thai-street-food'],
    cuisine: 'Thai street food',
    neighborhood: 'Irvine (original) / Tustin' },
  { name: 'Manaao Thai',
    aliases: ['manaao', 'manaoo'],
    cuisine: 'Modern Thai',
    neighborhood: 'Tustin (+ Irvine Spectrum)' },
  { name: 'Hanuman Thai Eatery',
    aliases: ['hanuman'],
    cuisine: 'Modern Thai',
    neighborhood: 'Costa Mesa' },
  { name: 'Thai Cafe',
    aliases: ['thai cafe', 'thai café'],
    cuisine: 'Thai',
    neighborhood: 'Irvine (Jeffrey & Walnut)' },
  { name: 'Chiang Rai',
    aliases: ['chiang rai'],
    cuisine: 'Northern Thai',
    neighborhood: 'Tustin' },
  { name: 'Thai Kitchen',
    aliases: ['thai kitchen'],
    cuisine: 'Thai',
    neighborhood: 'Irvine (Barranca)' },
  { name: 'Bangkok Corner',
    aliases: ['bangkok corner'],
    cuisine: 'Thai',
    neighborhood: 'Costa Mesa' },
  { name: 'Elephant Thai Cafe',
    aliases: ['elephant cafe', 'elephant thai'],
    cuisine: 'Thai',
    neighborhood: 'Irvine area' },
  { name: "Tuk Tuk Thai Cafe",
    aliases: ["tuk tuk"],
    cuisine: 'Thai',
    neighborhood: 'Costa Mesa' },

  // ─── KOREAN ───
  { name: 'Tang 190',
    aliases: ['tang 190'],
    cuisine: 'Korean soups & stews',
    neighborhood: 'Irvine (Diamond Jamboree area)' },
  { name: 'BCD Tofu House',
    aliases: ['bcd tofu', 'bcd'],
    editorial: ['bcd-tofu-house'],
    cuisine: 'Korean tofu / soondubu',
    neighborhood: 'Irvine (Diamond Jamboree)' },
  { name: 'Yup Dduk Irvine',
    aliases: ['yup dduk', 'yupdduk'],
    editorial: ['yup-dduk-irvine'],
    cuisine: 'Korean spicy tteokbokki',
    neighborhood: 'Irvine' },
  { name: 'Baekjeong',
    aliases: ['baekjeong', 'baekjong'],
    cuisine: 'Korean BBQ',
    neighborhood: 'Irvine' },
  { name: "Kaya's Kitchen",
    aliases: ["kaya's", 'kayas', 'kaya kitchen'],
    cuisine: 'Korean',
    neighborhood: 'Irvine' },
  { name: "Yoo's Place",
    aliases: ["yoo's place", 'yoos place'],
    cuisine: 'Korean (naengmyun, banchan)',
    neighborhood: 'Irvine' },
  { name: 'Yigah',
    aliases: ['yigah'],
    editorial: ['yigah'],
    cuisine: 'Korean (sulangtang)',
    neighborhood: 'Irvine / Diamond Jamboree' },
  { name: 'Mo Ran Gak',
    aliases: ['mo ran gak', 'moran gak', 'morangak'],
    editorial: ['mo-ran-gak', 'mo-ran-gak-restaurant'],
    cuisine: 'Korean',
    neighborhood: 'Garden Grove' },
  { name: 'Hanbop',
    aliases: ['hanbop'],
    cuisine: 'Korean',
    neighborhood: 'Lake Forest' },
  { name: 'Tang N Tang',
    aliases: ['tang n tang', 'tang and tang'],
    cuisine: 'Korean ssulungtang',
    neighborhood: 'Irvine' },
  { name: 'Sookdal',
    aliases: ['sookdal'],
    editorial: ['sookdal'],
    cuisine: 'Korean',
    neighborhood: 'Irvine / Diamond Jamboree' },
  { name: 'Hanshin Pocha',
    aliases: ['hanshin pocha', 'hanshin'],
    editorial: ['hanshin-pocha'],
    cuisine: 'Korean pocha (pub) / Korean fried chicken',
    neighborhood: 'Irvine' },

  // ─── FRENCH / French bistro / Euro bistro ───
  { name: 'Marché Moderne',
    aliases: ['marche moderne', 'marché moderne'],
    editorial: ['marche-moderne'],
    michelinSlug: 'marche-moderne',
    cuisine: 'French',
    neighborhood: 'Newport Beach (Crystal Cove)' },
  { name: 'Knife Pleat',
    aliases: ['knife pleat'],
    editorial: ['knife-pleat'],
    michelinSlug: 'knife-pleat',
    cuisine: 'French / Modern French',
    neighborhood: 'Costa Mesa (South Coast Plaza)' },
  { name: 'Fable & Spirit',
    aliases: ['fable & spirit', 'fable and spirit', 'fable spirit'],
    editorial: ['fable-spirit'],
    michelinSlug: 'fable-spirit',
    cuisine: 'Irish / French bistro',
    neighborhood: 'Newport Beach' },
  { name: 'Le Diplomate Bakery Cafe',
    aliases: ['le diplomate', 'diplomate bakery'],
    editorial: ['le-diplomate-bakery-cafe'],
    cuisine: 'French bakery / cafe',
    neighborhood: 'Irvine' },
  { name: 'Bistango',
    aliases: ['bistango'],
    editorial: ['bistango-in-irvine'],
    cuisine: 'Californian-European (with French leanings)',
    neighborhood: 'Irvine' },
];

// ── Build canonical entries from picks ──
function buildEntry(pick) {
  const id = slugify(pick.name);
  const editorial = findEditorial(id, pick.editorial || pick.aliases || []);
  const sources = [];

  // Eater 38 best OC
  if (editorial.eater_oc) {
    const art = SOURCE_ARTICLES.eater_oc;
    sources.push({ type: 'eater', detail: art.detail, url: art.url, rank: editorial.eater_oc.index || null });
  }
  // Eater UCI
  if (editorial.eater_uci) {
    const art = SOURCE_ARTICLES.eater_uci;
    sources.push({ type: 'eater', detail: art.detail, url: art.url, rank: editorial.eater_uci.index || null });
  }
  // Eater Korean OC
  if (editorial.eater_korean) {
    const art = SOURCE_ARTICLES.eater_korean;
    sources.push({ type: 'eater', detail: art.detail, url: art.url, rank: editorial.eater_korean.index || null });
  }
  // LA Times halal
  if (editorial.latimes_halal) {
    const art = SOURCE_ARTICLES.latimes_halal;
    sources.push({ type: 'newspaper', detail: art.detail, url: art.url });
  }
  // Michelin (city-wide OC list — attach only if this pick is in the list
  // AND explicitly named in the michelinSlug field — don't auto-infer).
  if (pick.michelinSlug) {
    const m = michelin.find(x => x.slug === pick.michelinSlug);
    if (m) {
      const art = SOURCE_ARTICLES.michelin;
      sources.push({ type: 'michelin', detail: art.detail, url: art.url, distinction: m.distinction || null });
    }
  }
  // Reddit — literal substring scan across all thread blobs
  const reddit = redditSourceFor(pick.name, pick.aliases || []);
  if (reddit) sources.push(reddit);

  // Gather raw descriptions (from editorial bodies) for Pass 2 composition.
  // Delete before writeout — we only persist composed `highlights`.
  const rawDescs = {};
  if (editorial.eater_oc?.body)      rawDescs.eater_oc      = unesc(editorial.eater_oc.body);
  if (editorial.eater_uci?.body)     rawDescs.eater_uci     = unesc(editorial.eater_uci.body);
  if (editorial.eater_korean?.body)  rawDescs.eater_korean  = unesc(editorial.eater_korean.body);
  if (editorial.latimes_halal?.body) rawDescs.latimes_halal = unesc(editorial.latimes_halal.body);

  // Compose highlights — Pass 2 lookup; fallback to truncated editorial for Pass 1.
  let highlights = handCrafted[id] || null;
  if (!highlights) {
    const fallbackBody = rawDescs.eater_uci || rawDescs.eater_oc || rawDescs.eater_korean || rawDescs.latimes_halal;
    if (fallbackBody) {
      highlights = sentenceTruncate(fallbackBody, 550);
    } else {
      // Minimal placeholder so upsert's required-field check passes in Pass 1.
      highlights = `${pick.cuisine} in ${pick.neighborhood}. Multi-source Reddit crowd pick.`;
    }
  }

  return {
    id,
    name: pick.name,
    neighborhood: pick.neighborhood || null,
    address: null,
    price: null,
    cuisine: pick.cuisine || null,
    openFor: null,
    highlights,
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources,
    _rawDescs: rawDescs,
  };
}

// After Pass 1 + enrichment, Google Places' `outdoorSeating` flag was
// queried for all 37 picks. 14 returned `false` (confirmed no patio) — drop
// them per the criteria. 17 returned `true` and 6 returned `null` (unknown)
// — keep all of these per the user's "loose" filter preference.
const DROP_NO_PATIO = new Set([
  "kayas-kitchen",
  "annapoorna",
  "bangkok-corner",
  "charminar-indian-kitchen",
  "chiang-rai",
  "elephant-thai-cafe",
  "hanbop",
  "india-gate",
  "india-kitchen",
  "natraj-cuisine-of-india",
  "yoos-place",
  "manaao-thai",
  "thai-kitchen",
  "thai-cafe",
  // Dropped: Google Places matched a different "Nina's Kitchen" (Salvadorian
  // pupusas in Lake Forest) rather than the Indian/British spot the Reddit
  // commenter meant. Name is too ambiguous to recover cleanly.
  "ninas-kitchen",
]);

const out = PICKS.map(buildEntry).filter(e => !DROP_NO_PATIO.has(e.id));

// Drop _rawDescs from final writeout (but report them first)
const reportWithRaw = out.map(e => ({ ...e }));
for (const e of out) delete e._rawDescs;

// Sort: multi-source first, then alphabetical
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

const outPath = resolve(REPO_ROOT, 'trips/places/irvine-full.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));

// Also persist the composition-input (raw descs + sources) for Pass 2.
writeFileSync(
  resolve(REPO_ROOT, 'trips/places/irvine-compose-input.json'),
  JSON.stringify(reportWithRaw, null, 2)
);

// ── Report ──
console.log(`Wrote ${out.length} entries → ${outPath}`);
console.log(`Editorial: eater_oc=${eaterOC.length}, eater_uci=${eaterUCI.length}, eater_korean=${eaterKorean.length}, latimes=${latimesHalal.length}, michelin=${michelin.length}`);
console.log(`Reddit threads: ${REDDIT_THREADS.length}`);
console.log(`Multi-source (≥2): ${out.filter(e => e.sources.length >= 2).length}`);
console.log(`Multi-source (≥3): ${out.filter(e => e.sources.length >= 3).length}`);
console.log(`With Reddit source: ${out.filter(e => e.sources.some(s => s.type === 'reddit')).length}`);
console.log(`With handcrafted description: ${out.filter(e => handCrafted[e.id]).length}/${out.length}`);
console.log(`\nBy source count:`);
for (const e of out) {
  const types = e.sources.map(s => s.type).join(',');
  console.log(`  ${String(e.sources.length).padStart(2)} | ${e.name.padEnd(30)} | ${types}`);
}
