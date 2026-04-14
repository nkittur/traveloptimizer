#!/usr/bin/env node
// _normalize-asheville-activities.mjs — Merge Asheville things-to-do sources
// (Atlas Obscura, Reddit r/asheville) plus hand-curated canonical activities.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

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

const CANONICAL_MERGES = {};
function canonicalize(rawName) {
  const rawSlug = slugify(rawName);
  const merged = CANONICAL_MERGES[rawSlug];
  if (merged) return { slug: merged.slug, name: merged.name };
  return { slug: rawSlug, name: rawName };
}

// ── Load raw sources ──
const atlasRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'atlas-asheville-raw.json'), 'utf-8'));
let tncRaw = [];
try { tncRaw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tnc-asheville-raw.json'), 'utf-8')); } catch {}

const SOURCE_ARTICLES = {
  atlas: {
    url: 'https://www.atlasobscura.com/things-to-do/asheville-north-carolina',
    detail: 'Atlas Obscura — 23 Cool and Unusual Things in Asheville',
  },
  tnc: {
    url: 'https://www.townandcountrymag.com/leisure/travel-guide/a46772119/t-and-c-travel-guide-3-days-in-asheville/',
    detail: 'Town & Country — 3 Days in Asheville',
  },
};

let handCrafted = {};
try {
  handCrafted = JSON.parse(readFileSync(resolve(REPO_ROOT, 'trips/places/asheville-activities-descriptions.json'), 'utf-8'));
} catch {}

function makeEntry(rawName, rawDescription, source, category = null) {
  const { slug, name } = canonicalize(rawName);
  return {
    id: slug, name,
    neighborhood: null, address: null, price: null,
    category: category, openFor: null, highlights: null,
    insiderTip: null, website: null, inTargetArea: true, notes: null,
    sources: [source],
    _rawDescs: rawDescription ? { [source.type]: unesc(rawDescription) } : {},
  };
}

const byId = new Map();
function addAll(entries) {
  for (const e of entries) {
    const existing = byId.get(e.id);
    if (!existing) { byId.set(e.id, { ...e, _rawDescs: { ...(e._rawDescs || {}) } }); continue; }
    for (const s of e.sources) {
      if (!existing.sources.find(es => es.type === s.type && es.detail === s.detail)) existing.sources.push(s);
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

// ── Atlas Obscura ──
addAll(atlasRaw.map((it, idx) => makeEntry(
  it.name, it.description,
  { type: 'atlas', detail: SOURCE_ARTICLES.atlas.detail, url: SOURCE_ARTICLES.atlas.url, rank: idx + 1 },
  'Hidden Gem',
)));

// ── T&C 3 Days (activities only) ──
// Filter false positives: events (Biltmore Blooms, Afterglow, Masterworks, ALT ASO),
// generic terms (guided tours, Haunted Asheville — that IS a tour company though)
const TNC_ACT_SKIP = new Set(['Biltmore Blooms', 'Afterglow', 'Masterworks', 'ALT ASO', 'guided tours', 'Haunted Asheville']);
// Map some names to existing canonicals
const TNC_ACT_REMAP = {
  'LaZoom Tours': 'LaZoom Comedy Tour',
  'Craggy Pinnacle Trail': 'Craggy Gardens',
};
const TNC_ACT_CATEGORIES = {
  'Asheville Art Museum': 'Museum / Art',
  'Center for Craft': 'Art / Craft',
  'Navitat Canopy Adventures': 'Outdoor Adventure',
  'French Broad Adventures': 'Outdoor / River',
  'Asheville Symphony': 'Music / Performing Arts',
};
const TNC_ACT_HIGHLIGHTS = {
  'Asheville Art Museum': "Downtown art museum focused on American art from the 20th and 21st centuries, with a strong Black Mountain College collection (the avant-garde school where artists like Willem de Kooning and Merce Cunningham taught in the 1930s–50s). Rooftop sculpture terrace with mountain views.",
  'Center for Craft': "Non-profit gallery and research center devoted to American craft — rotating exhibitions of ceramics, textiles, metalwork, and more. Free admission. An essential stop for understanding why Asheville matters in the craft world.",
  'Navitat Canopy Adventures': "Zip lining through Appalachian hardwood forest canopy 30 minutes from Asheville — their Moody Cove Adventure has ten zips, two sky bridges, and a rappel. A thrill-seeker bucket-list item.",
  'French Broad Adventures': "Whitewater rafting outfitter running the Class III–IV section of the French Broad River Gorge. Half-day and full-day trips. More adventurous than the lazy-float tubing options closer to town.",
  'Asheville Symphony': "Professional regional orchestra performing at the historic Thomas Wolfe Auditorium downtown. Classical, pops, and family concerts throughout the season.",
};
const tncActivities = tncRaw.filter(e => e.type === 'activity' && !TNC_ACT_SKIP.has(e.name));
for (const a of tncActivities) {
  const name = TNC_ACT_REMAP[a.name] || a.name;
  const entry = makeEntry(name, a.context,
    { type: 'tnc', detail: SOURCE_ARTICLES.tnc.detail, url: SOURCE_ARTICLES.tnc.url, day: a.day },
    TNC_ACT_CATEGORIES[name] || null);
  if (TNC_ACT_HIGHLIGHTS[name]) entry.highlights = TNC_ACT_HIGHLIGHTS[name];
  addAll([entry]);
}

// ── Canonical Asheville activities (curated from editorial + general knowledge) ──
// These are the must-do activities any Asheville guide would have. They get
// "editorial" treatment as a curated canonical source.
const CURATED = [
  { name: 'Biltmore Estate', category: 'Historic Estate / Grounds',
    highlights: "America's largest private home — a 250-room, 8,000-acre Vanderbilt Gilded Age château completed in 1895. Tour the house, gardens, and winery; stay for the seasonal illuminations. An all-day experience. Book timed tickets online ($90+)." },
  { name: 'Blue Ridge Parkway', category: 'Scenic Drive',
    highlights: "America's most-visited National Park Service unit — 469 miles of ridgetop highway through the Appalachians. The section near Asheville is the most dramatic. Craggy Gardens, Mount Pisgah, and Graveyard Fields are the nearby highlights. Best in October for peak fall color." },
  { name: 'River Arts District', category: 'Arts / Neighborhood',
    highlights: 'Revitalized industrial district along the French Broad River — 200+ working artist studios in converted warehouses. Most open to the public; the second-Saturday Studio Strolls are the best time to visit. Devastated by Helene 2024 but rebuilding.' },
  { name: 'North Carolina Arboretum', category: 'Garden / Nature',
    highlights: '434-acre public garden in Pisgah National Forest with curated plantings, bonsai exhibition, and 10 miles of trails. The Bonsai Exhibition Garden is a highlight — one of the best public collections in the country.' },
  { name: 'Folk Art Center', category: 'Art / Craft',
    highlights: 'Mile 382 on the Blue Ridge Parkway — headquarters of the Southern Highland Craft Guild since 1980. Juried Appalachian craft (pottery, weaving, woodwork) at museum-quality standards, all for sale. Free admission.' },
  { name: 'Mount Mitchell State Park', category: 'Hiking / Nature',
    highlights: 'The highest peak east of the Mississippi (6,684 ft) — a 45-minute drive up the Blue Ridge Parkway. Short paved summit trail or longer hikes from the base. The subalpine spruce-fir forest feels like Canada in the middle of NC.' },
  { name: 'DuPont State Forest', category: 'Hiking / Waterfalls',
    highlights: 'Home to the Hunger Games waterfalls — Triple Falls, High Falls, and Hooker Falls, all on an easy 3-mile loop. 10,400 acres of hiking, mountain biking, and equestrian trails. 45 minutes south of Asheville.' },
  { name: 'Chimney Rock State Park', category: 'Hiking / Scenic',
    highlights: "315-foot granite monolith with panoramic views over Lake Lure and the gorge. Take the elevator or climb the 499 stairs. Hickory Nut Falls is a short hike away. A Last of the Mohicans filming location." },
  { name: 'Grove Park Inn', category: 'Historic Hotel / Spa',
    highlights: "1913 granite-boulder hotel perched on Sunset Mountain — the panoramic sunset view from the Sunset Terrace is one of the best in the region (even if you're not staying). The subterranean spa is Asheville's most famous. December Gingerbread House Competition is a tradition." },
  { name: 'Downtown Asheville', category: 'Neighborhood / Shopping',
    highlights: 'Walkable Art Deco downtown with 200+ independent shops, buskers at every corner, Malaprop\'s bookstore, the Grove Arcade, and a dozen breweries within a 10-minute walk. Free outdoor drum circle at Pritchard Park every Friday evening.' },
  { name: 'French Broad River', category: 'Outdoor / River',
    highlights: "The third-oldest river in the world flows right through Asheville. Tubing, kayaking, paddleboarding from several outfitters. Zen Tubing is the most popular rental. Lazy float in summer; whitewater sections upriver." },
  { name: 'Craggy Gardens', category: 'Hiking / Scenic',
    highlights: 'Mile 364 Blue Ridge Parkway — highland bald famous for June rhododendron blooms (peak mid-June) that turn the mountaintop pink. The Craggy Pinnacle trail is 1.4 miles with 360° views. One of the most photographed spots on the Parkway.' },
  { name: 'Sierra Nevada Brewing', category: 'Brewery',
    highlights: "California brewery's massive East Coast facility in Mills River (15 min south of Asheville). Free tours, a restaurant, a tap room with 20+ beers, and expansive outdoor seating on the French Broad River. Family-friendly." },
  { name: 'Wedge Brewing at the Foundation', category: 'Brewery',
    highlights: "Iconic River Arts District brewery in a converted foundry — outdoor seating, food trucks, dogs everywhere, weekly events. The quintessential Asheville craft-beer experience. Sister location Wedge Studios hosts the Foundation's art studios." },
  { name: 'LaZoom Comedy Tour', category: 'Tour / Entertainment',
    highlights: "Purple comedy bus tour of Asheville — locals on r/Asheville say this one actually is worth it. Guides in costume, drinking allowed on board (BYOB), 90 minutes of Asheville history, weirdness, and jokes. The 'must-do' tourist thing." },
  { name: 'Max Patch', category: 'Hiking / Scenic',
    highlights: '4,629-ft grassy bald on the Appalachian Trail, an hour west of Asheville. Gentle 1.4-mile loop to a 360° summit with no trees in the way. Sunset here is the Asheville bucket-list view (r/Asheville: "sunset at Max Patch").' },
  { name: 'Jump Off Rock', category: 'Scenic Overlook',
    highlights: 'Short walk from parking to a cliff-edge overlook in Laurel Park (near Hendersonville) — three layers of Blue Ridge visible at sunset. Named for a Cherokee legend. r/Asheville sunset pick alongside Max Patch.' },
];

for (const c of CURATED) {
  const entry = makeEntry(c.name, c.highlights,
    { type: 'curated', detail: 'Asheville Canonical — Curated from editorial + local knowledge', rank: 0 },
    c.category);
  entry.highlights = c.highlights;
  addAll([entry]);
}

// ── Reddit picks ──
const REDDIT_THREADS_AVL = [
  { id: '1if9xya', title: 'Looking for hidden gems as a newby to Asheville', url: 'https://www.reddit.com/r/asheville/comments/1if9xya/looking_for_hidden_gems_as_a_newby_to_asheville/' },
  { id: '1ad7gl5', title: 'Moving away bucketlist!', url: 'https://www.reddit.com/r/asheville/comments/1ad7gl5/moving_away_bucketlist/' },
  { id: 'z0mwex', title: 'Asheville Hidden Gems', url: 'https://www.reddit.com/r/asheville/comments/z0mwex/asheville_hidden_gems/' },
];

const threadDataAVL = [];
for (let i = 0; i < REDDIT_THREADS_AVL.length; i++) {
  try {
    const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, `reddit-avl-ttd-${i + 1}.json`), 'utf-8'));
    const blob = (raw.postBody || '') + ' ' + (raw.comments || []).map(c => c.body).join(' ');
    threadDataAVL.push({ ...REDDIT_THREADS_AVL[i], blob: blob.toLowerCase(), comments: raw.comments || [] });
  } catch { threadDataAVL.push({ ...REDDIT_THREADS_AVL[i], blob: '', comments: [] }); }
}

function threadsMentioningAVL(name, aliases = []) {
  const candidates = [name, ...aliases].map(n => n.toLowerCase());
  return threadDataAVL.filter(t => candidates.some(c => t.blob.includes(c)))
    .map(t => ({ title: t.title, url: t.url }));
}

const REDDIT_ACTIVITIES_AVL = [
  // Cross-validate curated
  { name: 'Biltmore Estate', aliases: ['biltmore'] },
  { name: 'Blue Ridge Parkway', aliases: ['blue ridge parkway', 'parkway'] },
  { name: 'River Arts District', aliases: ['river arts', 'rad'] },
  { name: 'Max Patch', aliases: ['max patch'] },
  { name: 'Jump Off Rock', aliases: ['jump off rock', 'jumpoff'] },
  { name: 'LaZoom Comedy Tour', aliases: ['lazoom'] },
  { name: 'French Broad River', aliases: ['french broad'] },
  { name: 'Grove Park Inn', aliases: ['grove park'] },

  // Reddit-only finds
  { name: 'UNC Asheville Observatory', aliases: ['unc observatory', 'stargazing'], isNew: true,
    category: 'Stargazing',
    highlights: 'Free Friday-night stargazing sessions at the UNC Asheville observatory. Telescope viewing with astronomy graduate students. r/Asheville bucket-list pick.' },
  { name: 'Citizen Vinyl', aliases: ['citizen vinyl'], isNew: true,
    category: 'Music / Culture',
    highlights: 'Working vinyl record pressing plant in the historic S&W Cafeteria building — cocktails, records, and pressing tours. Home to Asheville\'s Creative Mornings chapter.' },
  { name: 'Riverside Cemetery', aliases: ['riverside cemetery'], isNew: true,
    category: 'Historic / Peaceful',
    highlights: "Beautiful 87-acre hilltop cemetery where Thomas Wolfe and O. Henry are buried. Quiet and peaceful for a picnic; older headstones are genuinely beautiful. 'One of my favorite places in town' — r/Asheville (21 upvotes)." },
  { name: 'Asheville Pinball Museum', aliases: ['pinball museum'], isNew: true,
    category: 'Museum / Games',
    highlights: 'Downtown attraction with 70+ pinball machines and classic arcade games — flat admission ($15) for unlimited play. Rotating lineup spanning the 1960s to today.' },
  { name: 'Drum Circle at Pritchard Park', aliases: ['drum circle', 'pritchard park'], isNew: true,
    category: 'Culture / Free',
    highlights: 'Friday-evening drum circle downtown since 2001 — locals, tourists, and travelers with instruments gather and jam. The quintessential quirky Asheville free experience.' },
  { name: 'Pisgah National Forest', aliases: ['pisgah'], isNew: true,
    category: 'Hiking / Nature',
    highlights: '500,000+ acres of hardwood forest, waterfalls, and mountains just west of Asheville. Looking Glass Falls, Sliding Rock (natural rock waterslide), and miles of Appalachian Trail. Free.' },
];

for (const f of REDDIT_ACTIVITIES_AVL) {
  const matchedThreads = threadsMentioningAVL(f.name, f.aliases || []);
  if (matchedThreads.length === 0) continue;
  const detail = matchedThreads.length === 1 ? `r/Asheville — ${matchedThreads[0].title}` : `r/Asheville — ${matchedThreads.length} threads`;
  const entry = makeEntry(f.name, f.highlights || null,
    { type: 'reddit', detail, threads: matchedThreads, mentions: matchedThreads.length },
    f.category || null);
  if (f.highlights) entry.highlights = f.highlights;
  addAll([entry]);
}

// ── Compose highlights ──
const NARRATIVE_PREFERENCE = ['curated', 'tnc', 'atlas', 'reddit'];
function composeHighlights(entry) {
  const override = handCrafted[entry.id];
  if (override) return override;
  const raws = entry._rawDescs || {};
  for (const type of NARRATIVE_PREFERENCE) {
    if (raws[type] && raws[type].length >= 30) return sentenceTruncate(raws[type], 700);
  }
  return null;
}

for (const entry of byId.values()) {
  entry.highlights = entry.highlights || composeHighlights(entry);
  delete entry._rawDescs;
}

const out = Array.from(byId.values()).filter(e => e.highlights);
out.sort((a, b) => {
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

writeFileSync(resolve(REPO_ROOT, 'trips/places/asheville-activities-full.json'), JSON.stringify(out, null, 2));

console.log(`Wrote ${out.length} entries → trips/places/asheville-activities-full.json`);
console.log(`  Atlas Obscura: ${atlasRaw.length}`);
console.log(`  Curated:       ${CURATED.length}`);
console.log(`  Reddit finds:  ${REDDIT_ACTIVITIES_AVL.length} from ${REDDIT_THREADS_AVL.length} threads`);
console.log(`  Multi-source (2+): ${out.filter(r => r.sources.length > 1).length}`);
console.log(`\nMulti-source:`);
for (const r of out.filter(r => r.sources.length > 1)) {
  console.log(`  ${r.sources.length}× ${r.name} [${r.category}] — ${r.sources.map(s => s.type).join(', ')}`);
}
