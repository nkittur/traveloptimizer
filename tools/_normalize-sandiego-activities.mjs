#!/usr/bin/env node
// _normalize-sandiego-activities.mjs — Merge all San Diego "things to do" sources
// (Time Out, CNT, Atlas Obscura, SD Magazine, Reddit) into a single normalized JSON.
// Uses the restaurant pipeline infrastructure with category for activity type.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Text cleanup ──
function unesc(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d').replace(/&ldquo;/g, '\u201c')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ').trim();
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
  return out.trim() || clean.slice(0, maxChars).trimEnd() + '…';
}

// ── Canonical merge table ──
const CANONICAL_MERGES = {
  // Time Out uses action-oriented names; normalize to place names
  'explore-cultural-institutions-at-balboa-park': { slug: 'balboa-park', name: 'Balboa Park' },
  'see-giant-pandas-at-san-diego-zoo':            { slug: 'san-diego-zoo', name: 'San Diego Zoo' },
  'attend-a-concert-at-the-rady-shell':           { slug: 'rady-shell', name: 'The Rady Shell at Jacobs Park' },
  'ride-a-roller-coaster-at-belmont-park':         { slug: 'belmont-park', name: 'Belmont Park' },
  'shop-and-dine-in-la-jolla-cove':               { slug: 'la-jolla-cove', name: 'La Jolla Cove' },
  'place-your-bets-at-del-mar-racetrack':         { slug: 'del-mar-racetrack', name: 'Del Mar Racetrack' },
  'catch-a-baseball-game-at-petco-park':          { slug: 'petco-park', name: 'Petco Park' },
  'hit-the-beach-at-hotel-del-coronado':          { slug: 'coronado', name: 'Coronado & Hotel del Coronado' },
  'get-a-taste-of-navy-life-at-uss-midway-museum': { slug: 'uss-midway-museum', name: 'USS Midway Museum' },
  'eat-mexican-food-in-barrio-logan':             { slug: 'barrio-logan', name: 'Barrio Logan' },
  'drink-local-craft-beer':                        { slug: 'craft-beer-scene', name: 'San Diego Craft Beer Scene' },
  'browse-little-italy-mercato-farmers-market':   { slug: 'little-italy', name: 'Little Italy' },
  'smell-the-flowers-at-san-diego-botanic-garden': { slug: 'san-diego-botanic-garden', name: 'San Diego Botanic Garden' },
  'check-out-nightlife-in-the-gaslamp-quarter':   { slug: 'gaslamp-quarter', name: 'Gaslamp Quarter' },
  'snap-pretty-pics-at-the-flower-fields':        { slug: 'the-flower-fields', name: 'The Flower Fields at Carlsbad Ranch' },
  'tour-a-lighthouse-at-cabrillo-national-monument': { slug: 'cabrillo-national-monument', name: 'Cabrillo National Monument' },
  'admire-exhibits-at-san-diego-museum-of-art':   { slug: 'san-diego-museum-of-art', name: 'San Diego Museum of Art' },
  'meditate-at-mission-basilica-san-diego-de-alcala': { slug: 'mission-basilica', name: 'Mission Basilica San Diego de Alcalá' },
  'book-a-lesson-with-surf-diva':                  { slug: 'surfing-la-jolla', name: 'Surfing in San Diego' },
  'watch-a-show-at-the-belly-up-tavern':          { slug: 'belly-up-tavern', name: 'Belly Up Tavern' },
  'take-flight-at-torrey-pines-gliderport':       { slug: 'torrey-pines-gliderport', name: 'Torrey Pines Gliderport' },
  'spot-marine-life-at-san-diego-whale-watch':    { slug: 'whale-watching', name: 'Whale Watching' },
  // CNT
  'torrey-pines-state-natural-reserve':            { slug: 'torrey-pines', name: 'Torrey Pines State Natural Reserve' },
  'museum-of-contemporary-art-san-diego':          { slug: 'mcasd', name: 'Museum of Contemporary Art San Diego' },
  'torrey-pines-golf-course':                      { slug: 'torrey-pines-golf', name: 'Torrey Pines Golf Course' },
  'the-rady-shell-at-jacobs-park':                 { slug: 'rady-shell', name: 'The Rady Shell at Jacobs Park' },
  'mission-basilica-san-diego-de-alcala':          { slug: 'mission-basilica', name: 'Mission Basilica San Diego de Alcalá' },
  'cedros-avenue-design-district':                 { slug: 'cedros-design-district', name: 'Cedros Avenue Design District' },
  'downtown-oceanside':                            { slug: 'downtown-oceanside', name: 'Downtown Oceanside' },
  // CNT "Coronado" vs Time Out "Hotel del Coronado"
  'coronado':                                      { slug: 'coronado', name: 'Coronado & Hotel del Coronado' },
  // Atlas Obscura
  'san-diego-museum-of-us':                        { slug: 'museum-of-us', name: 'San Diego Museum of Us' },
  '1895-looff-carousel':                           { slug: 'looff-carousel', name: '1895 Looff Carousel' },
  'fathom-bistro-bait-and-tackle':                { slug: 'fathom-bistro', name: 'Fathom Bistro, Bait, and Tackle' },
  'miniature-taco-bell':                           { slug: 'miniature-taco-bell', name: 'Miniature Taco Bell' },
  // SD Mag generic names → keep as-is but mark category
};

function canonicalize(rawName) {
  const rawSlug = slugify(rawName);
  const merged = CANONICAL_MERGES[rawSlug];
  if (merged) return { slug: merged.slug, name: merged.name };
  return { slug: rawSlug, name: rawName };
}

// ── Load raw sources ──
const timeoutRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'timeout-sandiego-raw.json'), 'utf-8'));
const cntRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'cnt-sandiego-raw.json'), 'utf-8'));
const atlasRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'atlas-sandiego-raw.json'), 'utf-8'));
const sdmagRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'sdmag-sandiego-raw.json'), 'utf-8'));

// ── Source articles ──
const SOURCE_ARTICLES = {
  timeout: {
    url: 'https://www.timeout.com/usa/things-to-do/best-things-to-do-in-san-diego',
    detail: 'Time Out — 22 Best Things to Do in San Diego',
  },
  cnt: {
    url: 'https://www.cntraveler.com/gallery/best-things-to-do-in-san-diego-from-museum-visits-to-scenic-hikes',
    detail: 'Condé Nast Traveler — 21 Best Things to Do in San Diego',
  },
  atlas: {
    url: 'https://www.atlasobscura.com/things-to-do/san-diego-california',
    detail: 'Atlas Obscura — Cool & Unusual Things in San Diego',
  },
  sdmag: {
    url: 'https://sandiegomagazine.com/things-to-do/a-locals-guide-to-visiting-san-diego/',
    detail: "San Diego Magazine — A Local's Guide: 20 Best Things to Do",
  },
};

// ── Hand-crafted descriptions (Pass 2) ──
let handCrafted = {};
try {
  handCrafted = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/sandiego-activities-descriptions.json'), 'utf-8'));
} catch { /* Pass 1 */ }

// ── Normalize ──
function makeEntry(rawName, rawDescription, source, category = null) {
  const { slug, name } = canonicalize(rawName);
  return {
    id: slug,
    name,
    neighborhood: null,
    address: null,
    price: null,
    category: category,
    openFor: null,
    highlights: null,
    insiderTip: null,
    website: null,
    inTargetArea: true,
    notes: null,
    sources: [source],
    _rawDescs: rawDescription ? { [source.type]: unesc(rawDescription) } : {},
  };
}

// ── Category assignments ──
const CATEGORIES = {
  'balboa-park': 'Park / Culture',
  'san-diego-zoo': 'Zoo / Wildlife',
  'rady-shell': 'Music / Entertainment',
  'belmont-park': 'Amusement Park',
  'la-jolla-cove': 'Beach / Scenic',
  'del-mar-racetrack': 'Entertainment',
  'petco-park': 'Sports',
  'coronado': 'Beach / Historic',
  'uss-midway-museum': 'Museum / History',
  'barrio-logan': 'Neighborhood / Art',
  'craft-beer-scene': 'Craft Beer',
  'little-italy': 'Neighborhood / Food',
  'san-diego-botanic-garden': 'Garden / Nature',
  'gaslamp-quarter': 'Nightlife / Dining',
  'the-flower-fields': 'Garden / Scenic',
  'cabrillo-national-monument': 'Monument / Hiking',
  'san-diego-museum-of-art': 'Museum / Art',
  'mission-basilica': 'Historic Site',
  'surfing-la-jolla': 'Surfing / Beach',
  'belly-up-tavern': 'Music / Nightlife',
  'torrey-pines-gliderport': 'Outdoor Adventure',
  'whale-watching': 'Wildlife / Ocean',
  'torrey-pines': 'Hiking / Nature',
  'mcasd': 'Museum / Art',
  'torrey-pines-golf': 'Golf',
  'sunset-cliffs': 'Scenic / Beach',
  'north-park': 'Neighborhood',
  'cedros-design-district': 'Shopping / Art',
  'downtown-oceanside': 'Beach / Neighborhood',
  'sunny-jim-cave-store': 'Hidden Gem',
  'spruce-street-suspension-bridge': 'Hidden Gem',
  'museum-of-us': 'Museum / Culture',
  'whaley-house': 'Historic / Haunted',
  'harpers-topiary-garden': 'Hidden Gem',
  'looff-carousel': 'Historic',
  'fathom-bistro': 'Hidden Gem',
  'miniature-taco-bell': 'Oddity',
  'anza-borrego': 'Desert / Day Trip',
  'safari-park': 'Zoo / Wildlife',
  'la-jolla-kayaking': 'Outdoor Adventure',
  'leopard-sharks': 'Wildlife / Ocean',
  'encinitas-meditation-gardens': 'Garden / Peaceful',
  'mission-trails': 'Hiking / Nature',
  'annies-canyon': 'Hiking',
  'iron-mountain': 'Hiking',
  'japanese-friendship-garden': 'Garden / Culture',
};

const byId = new Map();

function addAll(entries) {
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) {
      byId.set(e.id, { ...e, _rawDescs: { ...(e._rawDescs || {}) } });
      continue;
    }
    for (const s of e.sources) {
      if (!existing.sources.find(es => es.type === s.type && es.detail === s.detail)) {
        existing.sources.push(s);
      }
    }
    existing._rawDescs ||= {};
    for (const [type, desc] of Object.entries(e._rawDescs || {})) {
      if (desc && !existing._rawDescs[type]) existing._rawDescs[type] = desc;
    }
    for (const field of ['neighborhood', 'address', 'price', 'category', 'openFor', 'insiderTip', 'website', 'notes']) {
      if (existing[field] == null && e[field] != null) existing[field] = e[field];
    }
  }
}

// ── Normalize Time Out ──
addAll(timeoutRaw.map((it, idx) => {
  const entry = makeEntry(it.name, it.description, { type: 'timeout', detail: SOURCE_ARTICLES.timeout.detail, url: SOURCE_ARTICLES.timeout.url, rank: idx + 1 });
  return entry;
}));

// ── Normalize CNT ──
addAll(cntRaw.map((it, idx) => {
  const entry = makeEntry(unesc(it.name), unesc(it.description), { type: 'cnt', detail: SOURCE_ARTICLES.cnt.detail, url: SOURCE_ARTICLES.cnt.url, rank: idx + 1 });
  return entry;
}));

// ── Normalize Atlas Obscura ──
addAll(atlasRaw.map((it, idx) => {
  const entry = makeEntry(it.name, it.description, { type: 'atlas', detail: SOURCE_ARTICLES.atlas.detail, url: SOURCE_ARTICLES.atlas.url, rank: idx + 1 });
  return entry;
}));

// ── Normalize SD Magazine (skip overly generic food-only entries) ──
const SDMAG_SKIP = new Set([
  'Grab Coffee from a Local Haunt', 'Chow Down on Fish Tacos', 'Eat a Refreshing Acai Bowl',
  'Discover the Best Breads', 'Visit a Hole in the Wall Burger Joint', 'Try Cardiff Crack',
  'Indulge in San Diego\'s Best Sandwiches', 'Sip on San Diego Favorites', 'Dine for the \'Gram',
]);
const SDMAG_REMAP = {
  'Go for a Bike Ride': { slug: 'biking-san-diego', name: 'Biking San Diego', cat: 'Outdoor / Cycling' },
  'Visit a Museum': { slug: 'balboa-park', name: 'Balboa Park' },
  'Go on a Hike': { slug: 'torrey-pines', name: 'Torrey Pines State Natural Reserve' },
  'Explore a Farmer\'s Market': { slug: 'little-italy', name: 'Little Italy' },
  'Relax at the Beach': { slug: 'la-jolla-cove', name: 'La Jolla Cove' },
  'Go for a Boat Ride': { slug: 'san-diego-bay-sailing', name: 'San Diego Bay Sailing' },
  'Take a Cooking Class': { slug: 'cooking-classes', name: 'Cooking Classes' },
  'Learn to Surf': { slug: 'surfing-la-jolla', name: 'Surfing in San Diego' },
  'Wander Through Liberty Station': { slug: 'liberty-station', name: 'Liberty Station' },
  'Get Drinks with a View': { slug: 'sunset-cliffs', name: 'Sunset Cliffs' },
  'Discover a Speakeasy': { slug: 'speakeasy-scene', name: 'San Diego Speakeasy Scene' },
};

for (const it of sdmagRaw) {
  if (SDMAG_SKIP.has(it.name)) continue;
  const remap = SDMAG_REMAP[it.name];
  const rawName = remap ? remap.name : it.name;
  const entry = makeEntry(rawName, it.description, { type: 'sdmag', detail: SOURCE_ARTICLES.sdmag.detail, url: SOURCE_ARTICLES.sdmag.url });
  if (remap?.cat) entry.category = remap.cat;
  addAll([entry]);
}

// ── Reddit picks ──
const REDDIT_THREADS_SD = [
  { id: '18m9c6g', title: 'Quirky cool places that make San Diego, San Diego', url: 'https://www.reddit.com/r/sandiego/comments/18m9c6g/what_are_the_quirky_cool_places_that_make_san/' },
  { id: '1ivwmh7', title: "1 year in SD: What are some must-do's?", url: 'https://www.reddit.com/r/sandiego/comments/1ivwmh7/1_year_in_sd_what_are_some_mustdos_1_placed_youd/' },
  { id: '1c3avld', title: 'Coolest low cost to free things to do/see in SD', url: 'https://www.reddit.com/r/sandiego/comments/1c3avld/coolest_low_cost_to_free_things_to_dosee_in_sd/' },
];

const threadDataSD = [];
for (let i = 0; i < REDDIT_THREADS_SD.length; i++) {
  try {
    const file = resolve(REPO_ROOT, `reddit-sd-thread-${i + 1}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const blob = (raw.postBody || '') + ' ' + (raw.comments || []).map(c => c.body).join(' ');
    threadDataSD.push({ ...REDDIT_THREADS_SD[i], blob: blob.toLowerCase(), comments: raw.comments || [] });
  } catch {
    threadDataSD.push({ ...REDDIT_THREADS_SD[i], blob: '', comments: [] });
  }
}

function threadsMentioningSD(name, aliases = []) {
  const candidates = [name, ...aliases].map(n => n.toLowerCase());
  return threadDataSD.filter(t => candidates.some(c => t.blob.includes(c)))
    .map(t => ({ title: t.title, url: t.url }));
}

// Reddit cross-validates + new finds
const REDDIT_ACTIVITIES = [
  // Cross-validates editorial
  { name: 'Balboa Park', aliases: ['balboa park'] },
  { name: 'San Diego Zoo', aliases: ['sd zoo', 'the zoo'] },
  { name: 'Torrey Pines State Natural Reserve', aliases: ['torrey pines', 'hike torrey'] },
  { name: 'La Jolla Cove', aliases: ['la jolla cove'] },
  { name: 'Sunset Cliffs', aliases: ['sunset cliffs'] },
  { name: 'Coronado & Hotel del Coronado', aliases: ['coronado'] },
  { name: 'Cabrillo National Monument', aliases: ['cabrillo', 'cabrillio'] },
  { name: 'Torrey Pines Gliderport', aliases: ['gliderport', 'gliders'] },
  { name: 'The Rady Shell at Jacobs Park', aliases: ['rady shell'] },
  { name: 'Spruce Street Suspension Bridge', aliases: ['spruce street'] },
  { name: 'Little Italy', aliases: ['little italy'] },
  { name: 'Belmont Park', aliases: ['belmont park'] },
  { name: 'Surfing in San Diego', aliases: ['surfing', 'surf'] },

  // Reddit-only new finds
  { name: 'Anza-Borrego Desert State Park', aliases: ['anza borrego', 'anza-borrego'], isNew: true,
    category: 'Desert / Day Trip',
    highlights: 'Vast desert state park east of SD with wildflower superbloom in spring, slot canyons, and dark sky stargazing. A world away from the coast.' },
  { name: 'San Diego Zoo Safari Park', aliases: ['safari park'], isNew: true,
    category: 'Zoo / Wildlife',
    highlights: "San Diego Zoo's 1,800-acre sister park in Escondido — home to the only platypuses outside Australia. More immersive and spacious than the Zoo itself." },
  { name: 'La Jolla Sea Cave Kayaking', aliases: ['kayaking', 'cave exploring', 'la jolla kayak'], isNew: true,
    category: 'Outdoor Adventure',
    highlights: 'Paddle through the seven sea caves at La Jolla Cove — the most iconic San Diego outdoor adventure. Book a guided tour or rent your own.' },
  { name: 'Swim with Leopard Sharks', aliases: ['leopard sharks', 'leopard shark'], isNew: true,
    category: 'Wildlife / Ocean',
    highlights: 'Every summer (June–September), hundreds of leopard sharks gather in the shallow waters of La Jolla Shores. Snorkel right in — they are harmless and mesmerizing.' },
  { name: 'Encinitas Meditation Gardens', aliases: ['meditation gardens', 'encinitas'], isNew: true,
    category: 'Garden / Peaceful',
    highlights: 'Self-Realization Fellowship gardens perched on a cliff overlooking the ocean in Encinitas. Free, serene, and one of the most beautiful spots on the coast. 89 Reddit upvotes.' },
  { name: 'Mission Trails Regional Park', aliases: ['mission trails'], isNew: true,
    category: 'Hiking / Nature',
    highlights: "One of the largest urban parks in the US — Cowles Mountain summit hike is the most popular, with panoramic views of the city. The visitor center trails are gentler." },
  { name: "Annie's Canyon Trail", aliases: ["annie's canyon", 'annies canyon'], isNew: true,
    category: 'Hiking',
    highlights: 'A short but thrilling slot-canyon hike in Solana Beach — squeeze through narrow sandstone walls to a lagoon overlook. Under a mile round trip.' },
  { name: 'Iron Mountain Trail', aliases: ['iron mountain', 'iron mtn'], isNew: true,
    category: 'Hiking',
    highlights: '3.1 miles to the summit with panoramic views. Gorgeous in spring when the wild lilacs bloom. r/SanDiego favorite.' },
  { name: 'Japanese Friendship Garden', aliases: ['japanese friendship garden', 'japanese garden'], isNew: true,
    category: 'Garden / Culture',
    highlights: 'Twelve-acre traditional Japanese garden in Balboa Park — koi pond, bonsai collection, an origami workshop space. ~$14 admission and worth every penny.' },
  { name: 'OB Farmers Market', aliases: ['ob farmers market', 'ocean beach farmers'], isNew: true,
    category: 'Market / Community',
    highlights: 'Wednesday evening farmers market on Newport Avenue in Ocean Beach — live music, local produce, street food, and the quintessential OB vibe.' },
];

for (const f of REDDIT_ACTIVITIES) {
  const matchedThreads = threadsMentioningSD(f.name, f.aliases || []);
  if (matchedThreads.length === 0) continue;

  const detail = matchedThreads.length === 1
    ? `r/SanDiego — ${matchedThreads[0].title}`
    : `r/SanDiego — ${matchedThreads.length} threads`;

  const entry = makeEntry(
    f.name,
    f.highlights || null,
    { type: 'reddit', detail, threads: matchedThreads, mentions: matchedThreads.length },
    f.category || null,
  );
  if (f.highlights) entry.highlights = f.highlights;
  addAll([entry]);
}

// ── Apply categories ──
for (const entry of byId.values()) {
  if (!entry.category && CATEGORIES[entry.id]) {
    entry.category = CATEGORIES[entry.id];
  }
}

// ── Compose highlights ──
const NARRATIVE_PREFERENCE = ['cnt', 'timeout', 'sdmag', 'atlas', 'reddit'];

function composeHighlights(entry) {
  const override = handCrafted[entry.id];
  if (override) return override;
  const raws = entry._rawDescs || {};
  for (const type of NARRATIVE_PREFERENCE) {
    if (raws[type] && raws[type].length >= 30) {
      return sentenceTruncate(raws[type], 700);
    }
  }
  return null;
}

for (const entry of byId.values()) {
  entry.highlights = entry.highlights || composeHighlights(entry);
  delete entry._rawDescs;
}

// Remove entries without highlights
const out = Array.from(byId.values()).filter(e => e.highlights);
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/sandiego-activities-full.json'), JSON.stringify(out, null, 2));

// ── Report ──
console.log(`Wrote ${out.length} entries → trips/places/sandiego-activities-full.json`);
console.log(`  Time Out:     ${timeoutRaw.length}`);
console.log(`  CNT:          ${cntRaw.length}`);
console.log(`  Atlas Obscura: ${atlasRaw.length}`);
console.log(`  SD Magazine:  ${sdmagRaw.length}`);
console.log(`  Reddit:       ${REDDIT_ACTIVITIES.length} from ${REDDIT_THREADS_SD.length} threads`);
console.log(`  Multi-source (2+): ${out.filter(r => r.sources.length > 1).length}`);
console.log(`  Multi-source (3+): ${out.filter(r => r.sources.length > 2).length}`);
console.log(`\nMulti-source:`);
for (const r of out.filter(r => r.sources.length > 1).slice(0, 40)) {
  console.log(`  ${r.sources.length}× ${r.name} [${r.category || '?'}] — ${r.sources.map(s => s.type).join(', ')}`);
}
console.log(`\nReddit-only:`);
for (const r of out.filter(r => r.sources.length === 1 && r.sources[0].type === 'reddit')) {
  console.log(`  ${r.name} [${r.category || '?'}]`);
}
