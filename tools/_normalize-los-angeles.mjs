#!/usr/bin/env node
// _normalize-los-angeles.mjs — Merge LA editorial + Reddit signal into a
// curated picks list biased toward UCLA/Westwood/Westside. Each reddit
// source carries actual comment snippets with scores + a valence label so
// the webapp can show degree and direction of the crowd recommendation
// (top-pick / strong / mixed / skeptical / single-mention).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCRAPES = resolve(REPO_ROOT, 'scrapes/los-angeles');

// ── Text cleanup ──
function unesc(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d').replace(/&ldquo;/g, '\u201c')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\{:\s*[^}]+\}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function sentenceTruncate(s, maxChars = 650) {
  if (!s) return null;
  const clean = unesc(s);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = '';
  for (const sent of sentences) {
    if (out.length > 0 && out.length + sent.length > maxChars) break;
    out += sent;
    if (out.length >= maxChars * 0.95) break;
  }
  return out.trim() || null;
}

function normalizeForMatch(s) {
  return String(s).toLowerCase().replace(/[\u2018\u2019'`]/g, '');
}

// ── Editorial sources ──
const SOURCE_ARTICLES = {
  eater_la38: {
    url: 'https://la.eater.com/maps/best-los-angeles-restaurants-eater-38-essential',
    detail: 'Eater LA — The 38 Best Restaurants in Los Angeles',
  },
  latimes_101: {
    url: 'https://www.latimes.com/food/list/101-best-restaurants-los-angeles',
    detail: 'LA Times — 101 Best Restaurants in Los Angeles (2025)',
  },
  infatuation_la25: {
    url: 'https://www.theinfatuation.com/los-angeles/guides/best-restaurants-los-angeles',
    detail: 'The Infatuation — The 25 Best Restaurants in Los Angeles',
  },
  infatuation_westwood: {
    url: 'https://www.theinfatuation.com/los-angeles/guides/where-to-eat-in-westwood',
    detail: 'The Infatuation — The 18 Best Restaurants in Westwood',
  },
  infatuation_westside: {
    url: 'https://www.theinfatuation.com/los-angeles/guides/the-westside-hit-list',
    detail: 'The Infatuation — The 9 Best New Restaurants on the Westside',
  },
  michelin: {
    url: 'https://guide.michelin.com/us/en/california/los-angeles/restaurants',
    detail: 'Michelin Guide — Los Angeles',
  },
};

// ── Reddit threads ──
const REDDIT_THREADS = [
  { n: 1, sub: 'FoodLosAngeles', id: '15w03nr', title: 'General recommendations for Westwood / UCLA' },
  { n: 2, sub: 'FoodLosAngeles', id: '1gkp5y0', title: 'Trip to Westwood / UCLA Area' },
  { n: 3, sub: 'FoodLosAngeles', id: '1mf6sj5', title: 'Westside — beloved local/legendary spots' },
  { n: 4, sub: 'FoodLosAngeles', id: '1ihbbe8', title: 'Best restaurants near Westwood or Brentwood' },
  { n: 5, sub: 'FoodLosAngeles', id: '1azwx8d', title: 'Good date restaurant in Westwood or Brentwood' },
  { n: 6, sub: 'FoodLosAngeles', id: '1rmlc6a', title: "r/FoodLosAngeles — 2025's Best Restaurants Poll" },
  { n: 7, sub: 'FoodLosAngeles', id: '1ibq99c', title: 'My Favorite LA Spots (Jan 2025)' },
  { n: 8, sub: 'FoodLosAngeles', id: '1ovofvv', title: 'Best casual meal on the west side' },
];

// Load each thread; split comments but also keep the post body as a pseudo-comment
// with score 0 so we still match restaurants mentioned only in the OP.
const threadsLoaded = REDDIT_THREADS.map(t => {
  const path = resolve(SCRAPES, `reddit-thread-${t.n}.json`);
  if (!existsSync(path)) return { ...t, comments: [] };
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  return {
    ...t,
    title: d.title || t.title,
    url: d.url,
    postBody: d.postBody || '',
    comments: (d.comments || []).map(c => ({
      score: c.score || 0,
      body: c.body || '',
      bodyLc: normalizeForMatch(c.body || ''),
    })),
  };
});

// Find matching comments across all threads for a restaurant. Returns up to
// TOP_N sorted by score desc, each annotated with the thread it came from.
const TOP_SNIPPETS = 5;
function redditMatchesFor(name, aliases = []) {
  const needles = [name, ...aliases].map(normalizeForMatch).filter(n => n.length >= 3);
  const matches = [];  // {threadTitle, threadUrl, score, text}
  const threadsHit = new Map();
  for (const t of threadsLoaded) {
    let threadMentioned = false;
    // Post body — synthetic score equal to the post's net upvotes isn't
    // available here; treat as score 0 but still evidence.
    const postLc = normalizeForMatch(t.postBody);
    if (needles.some(n => postLc.includes(n))) {
      threadMentioned = true;
      matches.push({ threadTitle: t.title, threadUrl: t.url, score: 0, text: t.postBody.trim().slice(0, 300), origin: 'post' });
    }
    for (const c of t.comments) {
      if (needles.some(n => c.bodyLc.includes(n))) {
        threadMentioned = true;
        matches.push({ threadTitle: t.title, threadUrl: t.url, score: c.score, text: c.body.trim().slice(0, 300), origin: 'comment' });
      }
    }
    if (threadMentioned) threadsHit.set(t.id, t);
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, TOP_SNIPPETS), threadsHit: Array.from(threadsHit.values()) };
}

// Heuristic valence — read top-3 matched snippets and look for explicit
// positive vs negative cues. Conservative: default to null if we can't tell.
const POS_CUES = [
  /\b(best|favorite|amazing|incredible|phenomenal|outstanding|must[- ]try|must[- ]visit|can[\u2019']?t miss|legendary|love(?:d)? (?:it|this)|divine|perfect|top[- ]tier|hands down|killer|crushing|absolute|no[- ]brainer)\b/i,
  /\b(top \d+|one of the best|on any top|never disappoints|worth the drive|highly recommend)\b/i,
];
const NEG_CUES = [
  /\b(overrated|mid(?:-|\s|$)|disappoint|underwhelm|not (?:worth|great|good|impressed)|mediocre|terrible|skip it|hype|overhyped|awful|horrible)\b/i,
  /don['\u2019]t (?:go|eat|bother|recommend)\b/i,
];

function scoreSnippet(text) {
  const pos = POS_CUES.some(re => re.test(text));
  const neg = NEG_CUES.some(re => re.test(text));
  if (pos && !neg) return 1;
  if (neg && !pos) return -1;
  if (pos && neg) return 0;  // mixed-in-one
  return 0;
}

// Reddit comments are telegraphic — a top-of-thread rec often just names the
// restaurant ("Pizzana", 46▲) with no adjective to pattern-match. The upvote
// count IS the sentiment. So we drive valence primarily off score thresholds
// and only override to mixed/skeptical when an explicit negative cue fires
// in a high-score comment.
function computeValence(matches) {
  if (!matches.length) return null;

  // Inspect each match's score + explicit tone
  let hiPos = 0;        // score ≥ 10, not negatively toned
  let medPos = 0;       // score 5-9, not negatively toned
  let totalCountable = 0;
  let hiNeg = 0;        // score ≥ 5, explicitly negative language
  let topScore = 0;
  for (const m of matches) {
    const tone = scoreSnippet(m.text);
    if (m.score > topScore) topScore = m.score;
    if (tone < 0 && m.score >= 5) { hiNeg++; continue; }  // explicit skepticism
    if (m.score >= 10) hiPos++;
    else if (m.score >= 5) medPos++;
    if (m.score >= 1) totalCountable++;
  }

  // Explicit-skepticism beats everything if it wins the volume
  if (hiNeg >= 1 && hiPos + medPos >= 1) return 'mixed';
  if (hiNeg >= 1 && hiPos === 0 && medPos === 0) return 'skeptical';

  // Score-driven positive tiers — no adjective cue required
  if (hiPos >= 2) return 'top-pick';                // ≥2 separate comments at ≥10 upvotes
  if (hiPos >= 1 && (medPos >= 1 || matches.length >= 2)) return 'top-pick';  // 1 hi + corroboration
  if (hiPos >= 1) return 'strong';
  if (medPos >= 2) return 'strong';
  if (medPos >= 1) return 'strong';

  // Only-low-score matches
  if (matches.length === 1 && topScore < 3) return 'single-mention';
  if (matches.length <= 2) return 'mentioned';
  return 'mentioned';
}

// ── Load editorial scrapes ──
const eater38 = JSON.parse(readFileSync(resolve(SCRAPES, 'eater-la-38-raw.json'), 'utf-8'));
const latimes101 = JSON.parse(readFileSync(resolve(SCRAPES, 'latimes-101-la-raw.json'), 'utf-8'));
const infLa25 = JSON.parse(readFileSync(resolve(SCRAPES, 'infatuation-la25-raw.json'), 'utf-8'));
const infWw = JSON.parse(readFileSync(resolve(SCRAPES, 'infatuation-westwood-raw.json'), 'utf-8'));
const infWs = JSON.parse(readFileSync(resolve(SCRAPES, 'infatuation-westside-raw.json'), 'utf-8'));
const michelin = JSON.parse(readFileSync(resolve(SCRAPES, 'michelin-la-raw.json'), 'utf-8'));

const editorialBySlug = {};
function indexEditorial(entries, key) {
  for (const e of entries) {
    if (!e.name) continue;
    const s = slugify(e.name);
    editorialBySlug[s] ??= {};
    editorialBySlug[s][key] = e;
  }
}
indexEditorial(eater38, 'eater_la38');
indexEditorial(latimes101, 'latimes_101');
indexEditorial(infLa25, 'infatuation_la25');
indexEditorial(infWw, 'infatuation_westwood');
indexEditorial(infWs, 'infatuation_westside');
indexEditorial(michelin, 'michelin');

function findEditorial(slug, aliases = []) {
  const keys = [slug, ...aliases.map(slugify)];
  const out = {};
  for (const k of keys) if (editorialBySlug[k]) Object.assign(out, editorialBySlug[k]);
  return out;
}

// ── Hand-crafted descriptions ──
const DESC_PATH = resolve(REPO_ROOT, 'trips/places/los-angeles-descriptions.json');
const handCrafted = existsSync(DESC_PATH) ? JSON.parse(readFileSync(DESC_PATH, 'utf-8')) : {};

// ── PICKS — curated list biased toward Westside ──
//
// Each pick:
//   name, aliases, cuisine, neighborhood
//   editorial[]  — raw slugs to pull editorial prose from (optional)
//   tier         — "ucla-walkable" | "sawtelle" | "westside" | "drive" (determines default priority)
const PICKS = [
  // ─── UCLA-walkable / Westwood ───
  { name: 'Attari Sandwich Shop', aliases: ['attari', 'atari for sandwiches'],
    cuisine: 'Persian sandwiches', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['attari-sandwich-shop'] },
  { name: 'Sunnin Lebanese Cafe', aliases: ['sunnin lebanese', 'sunnin'],
    cuisine: 'Lebanese', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['sunnin-lebanese-cafe'] },
  { name: 'Shamshiri Grill', aliases: ['shamshiri'],
    cuisine: 'Persian', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['shamshiri-grill'] },
  { name: 'Taste of Tehran', aliases: ['taste of tehran'],
    cuisine: 'Persian', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['taste-of-tehran'] },
  { name: 'Toranj', aliases: ['toranj'],
    cuisine: 'Persian', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['toranj'] },
  { name: 'Saffron & Rose Ice Cream', aliases: ['saffron & rose', 'saffron and rose'],
    cuisine: 'Persian ice cream', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['saffron-rose-ice-cream'] },
  { name: 'Diddy Riese', aliases: ['diddy riese', 'diddy reese'],
    cuisine: 'Ice-cream sandwiches', neighborhood: 'Westwood Village', tier: 'ucla-walkable',
    editorial: ['diddy-riese'] },
  { name: 'Gushi', aliases: ['gushi'],
    cuisine: 'Korean rice bowls', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['gushi'] },
  { name: 'Hakata Izakaya Hero', aliases: ['hakata izakaya hero'],
    cuisine: 'Japanese izakaya', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['hakata-izakaya-hero'] },
  { name: 'Lulu', aliases: ['lulu at the hammer', 'lulu'],
    cuisine: 'Californian (Alice Waters)', neighborhood: 'Westwood (Hammer Museum)', tier: 'ucla-walkable',
    editorial: ['lulu'] },
  { name: 'Emporium Thai', aliases: ['emporium thai'],
    cuisine: 'Modern Thai', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['emporium-thai'] },
  { name: 'Lima Nikkei', aliases: ['lima nikkei'],
    cuisine: 'Peruvian-Japanese', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['lima-nikkei'] },
  { name: 'Violet Bistro', aliases: ['violet bistro', 'violet in westwood'],
    cuisine: 'French bistro', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['violet-bistro'] },
  { name: 'Hamasaku', aliases: ['hamasaku'],
    cuisine: 'Sushi', neighborhood: 'West LA (Sawtelle-adjacent)', tier: 'ucla-walkable',
    editorial: ['hamasaku'] },
  { name: 'House of Mandi', aliases: ['house of mandi'],
    cuisine: 'Yemeni', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['house-of-mandi'] },
  { name: 'Sichuan Impression', aliases: ['sichuan impression'],
    cuisine: 'Sichuan', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['sichuan-impression'] },
  { name: 'KazuNori', aliases: ['kazunori', 'kazu nori'],
    cuisine: 'Handroll bar', neighborhood: 'Westwood (also DTLA)', tier: 'ucla-walkable' },
  { name: 'Bella Pita', aliases: ['bella pita'],
    cuisine: 'Mediterranean pita', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['bella-pita'] },

  // ─── Sawtelle Japantown (short drive from UCLA) ───
  { name: 'Tsujita LA Artisan Noodle', aliases: ['tsujita la', 'tsujita', 'tsujita annex'],
    cuisine: 'Tsukemen / ramen', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Hide Sushi', aliases: ['hide sushi'],
    cuisine: 'Sushi (old-school)', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Tuk Tuk Thai', aliases: ['tuk tuk'],
    cuisine: 'Thai', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Killer Noodle Tsujita', aliases: ['killer noodle'],
    cuisine: 'Tan-tan noodles', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Marugame Udon', aliases: ['marugame udon'],
    cuisine: 'Udon', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Tatsu Ramen', aliases: ['tatsu ramen', 'tatsu'],
    cuisine: 'Ramen', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Daikokuya', aliases: ['daikokuya'],
    cuisine: 'Ramen', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Menya Tigre', aliases: ['menya tigre'],
    cuisine: 'Japanese curry', neighborhood: 'Sawtelle', tier: 'sawtelle' },
  { name: 'Qin West Noodle', aliases: ['qin west', 'qin west noodle'],
    cuisine: 'Xi\u2019an noodles', neighborhood: 'Sawtelle / Westwood', tier: 'sawtelle' },
  { name: 'Apple Pan', aliases: ['apple pan'],
    cuisine: 'Classic burgers / pies', neighborhood: 'West LA (Pico)', tier: 'sawtelle' },

  // ─── Brentwood / Santa Monica / Venice / Culver City ───
  { name: 'Pizzana', aliases: ['pizzana'],
    cuisine: 'Neapolitan pizza', neighborhood: 'Brentwood', tier: 'westside' },
  { name: 'A.O.C.', aliases: ['aoc', 'a.o.c.'],
    cuisine: 'Californian wine bar', neighborhood: 'Brentwood / West Hollywood', tier: 'westside' },
  { name: 'Jon & Vinny\u2019s', aliases: ['jon & vinny', 'jon and vinny', 'jon vinnys'],
    cuisine: 'Italian-American', neighborhood: 'Brentwood / Fairfax', tier: 'westside' },
  { name: 'Gjelina', aliases: ['gjelina'],
    cuisine: 'New American / wood-fired', neighborhood: 'Venice (Abbot Kinney)', tier: 'westside',
    editorial: ['gjelina'] },
  { name: 'Gjusta', aliases: ['gjusta'],
    cuisine: 'Bakery / deli', neighborhood: 'Venice', tier: 'westside' },
  { name: 'Pasjoli', aliases: ['pasjoli'],
    cuisine: 'Modern French', neighborhood: 'Santa Monica', tier: 'westside',
    editorial: ['pasjoli'] },
  { name: 'Holbox', aliases: ['holbox'],
    cuisine: 'Yucatecan seafood', neighborhood: 'South LA (Mercado La Paloma)', tier: 'drive',
    editorial: ['holbox'] },
  { name: 'Sorrento Italian Market', aliases: ['sorrento italian', 'sorrento italien'],
    cuisine: 'Italian deli / sandwiches', neighborhood: 'West LA', tier: 'westside' },
  { name: 'Simpang Asia', aliases: ['simpang asia'],
    cuisine: 'Indonesian / Malay', neighborhood: 'Palms', tier: 'westside' },
  { name: 'n/naka', aliases: ['n/naka', 'nnaka', 'n-naka'],
    cuisine: 'Kaiseki (2-star Michelin)', neighborhood: 'Palms', tier: 'westside' },
  // Dialogue (closed in 2023) removed
  { name: 'Found Oyster', aliases: ['found oyster'],
    cuisine: 'Seafood', neighborhood: 'East Hollywood', tier: 'drive',
    editorial: ['found-oyster'] },
  { name: 'Saffy\u2019s', aliases: ['saffys', "saffy's"],
    cuisine: 'Eastern Mediterranean', neighborhood: 'East Hollywood', tier: 'drive' },

  // ─── Westside "new" (Infatuation Hit List) ───
  { name: 'Clark\u2019s Oyster Bar', aliases: ['clarks oyster', "clark's oyster bar"],
    cuisine: 'Oyster bar', neighborhood: 'Montana Ave, Santa Monica', tier: 'westside',
    editorial: ['clarks-oyster-bar'] },
  { name: 'The Wilkes', aliases: ['the wilkes', 'wilkes'],
    cuisine: 'Brasserie', neighborhood: 'Marina del Rey / Culver', tier: 'westside',
    editorial: ['the-wilkes'] },
  { name: 'The Mulberry', aliases: ['the mulberry', 'mulberry'],
    cuisine: 'Italian', neighborhood: 'Westside', tier: 'westside',
    editorial: ['the-mulberry'] },
  { name: 'Utamaro Sushi Izakaya', aliases: ['utamaro sushi'],
    cuisine: 'Sushi izakaya', neighborhood: 'Westside', tier: 'westside',
    editorial: ['utamaro-sushi-izakaya'] },
  { name: 'Kojima', aliases: ['kojima'],
    cuisine: 'Japanese tasting', neighborhood: 'Westside', tier: 'westside',
    editorial: ['kojima'] },
  { name: 'Holy Basil', aliases: ['holy basil'],
    cuisine: 'Northern Thai', neighborhood: 'DTLA (+ Westside expansion)', tier: 'westside',
    editorial: ['holy-basil'] },

  // ─── LA standouts worth a drive (destination dining) ───
  { name: 'Providence', aliases: ['providence'],
    cuisine: 'Seafood tasting (2-star Michelin)', neighborhood: 'Hollywood', tier: 'drive' },
  { name: 'Kato', aliases: ['kato'],
    cuisine: 'Taiwanese tasting (2-star Michelin)', neighborhood: 'West Adams / DTLA', tier: 'drive',
    editorial: ['kato'] },
  { name: 'Hayato', aliases: ['hayato'],
    cuisine: 'Kaiseki (3-star Michelin)', neighborhood: 'DTLA (Arts District)', tier: 'drive',
    editorial: ['hayato'] },
  { name: 'Somni', aliases: ['somni'],
    cuisine: 'Tasting menu (2-star Michelin)', neighborhood: 'West Hollywood', tier: 'drive',
    editorial: ['somni'] },
  { name: 'Bestia', aliases: ['bestia'],
    cuisine: 'Italian', neighborhood: 'DTLA (Arts District)', tier: 'drive',
    editorial: ['bestia'] },
  { name: 'Bavel', aliases: ['bavel'],
    cuisine: 'Middle Eastern', neighborhood: 'DTLA (Arts District)', tier: 'drive',
    editorial: ['bavel'] },
  { name: 'Funke', aliases: ['funke'],
    cuisine: 'Italian (handmade pasta)', neighborhood: 'Beverly Hills', tier: 'westside',
    editorial: ['funke'] },
  { name: 'Baroo', aliases: ['baroo'],
    cuisine: 'Korean modern tasting', neighborhood: 'Arts District / Culver City', tier: 'drive',
    editorial: ['baroo'] },
  { name: 'Destroyer', aliases: ['destroyer'],
    cuisine: 'Modernist tasting (Jordan Kahn)', neighborhood: 'Culver City', tier: 'westside',
    editorial: ['destroyer'] },
  { name: 'Antico Nuovo', aliases: ['antico nuovo'],
    cuisine: 'Californian-Italian', neighborhood: 'Koreatown / Mid-Wilshire', tier: 'drive',
    editorial: ['antico-nuovo'] },
  { name: 'Azizam', aliases: ['azizam'],
    cuisine: 'Modern Persian', neighborhood: 'Silver Lake', tier: 'drive',
    editorial: ['azizam'] },
  { name: 'Moo\u2019s Craft Barbecue', aliases: ['moos craft barbecue', "moo's craft barbecue", 'moos craft'],
    cuisine: 'Central Texas BBQ', neighborhood: 'Lincoln Heights', tier: 'drive',
    editorial: ['moo-s-craft-barbecue', 'moos-craft-barbecue'] },
  { name: 'Damian', aliases: ['damian'],
    cuisine: 'Modern Mexican (Enrique Olvera)', neighborhood: 'Arts District', tier: 'drive',
    editorial: ['damian'] },
  { name: 'Luv2Eat Thai Bistro', aliases: ['luv2eat thai', 'luv2eat'],
    cuisine: 'Southern Thai', neighborhood: 'Hollywood', tier: 'drive',
    editorial: ['luv2eat-thai-bistro'] },
  { name: 'Soban', aliases: ['soban'],
    cuisine: 'Korean (banchan)', neighborhood: 'Koreatown', tier: 'drive',
    editorial: ['soban'] },
  { name: 'Yang\u2019s Kitchen', aliases: ['yangs kitchen', "yang's kitchen"],
    cuisine: 'Taiwanese', neighborhood: 'Alhambra', tier: 'drive',
    editorial: ['yang-s-kitchen', 'yangs-kitchen'] },
  { name: 'Camélia', aliases: ['camelia', 'camélia'],
    cuisine: 'French (tasting)', neighborhood: 'Arts District', tier: 'drive',
    editorial: ['camelia'] },
  { name: 'Perilla L.A.', aliases: ['perilla la', 'perilla l.a.'],
    cuisine: 'Modern Korean', neighborhood: 'DTLA', tier: 'drive',
    editorial: ['perilla-l-a', 'perilla-la'] },
  { name: 'Café Glacé', aliases: ['cafe glace', 'café glacé'],
    cuisine: 'Persian café', neighborhood: 'Westwood', tier: 'ucla-walkable',
    editorial: ['cafe-glace', 'café-glacé'] },
  { name: 'Seline', aliases: ['seline'],
    cuisine: 'Contemporary tasting', neighborhood: 'Santa Monica', tier: 'westside',
    editorial: ['seline'] },
  { name: 'Dunsmoor', aliases: ['dunsmoor'],
    cuisine: 'Hearth-cooked American', neighborhood: 'Glassell Park', tier: 'drive',
    editorial: ['dunsmoor'] },
  { name: 'Anajak Thai', aliases: ['anajak thai', 'anajak thai cuisine'],
    cuisine: 'Thai', neighborhood: 'Sherman Oaks', tier: 'drive',
    editorial: ['anajak-thai-cuisine', 'anajak-thai'] },
  { name: 'Bistro Na\u2019s', aliases: ['bistro nas', "bistro na's"],
    cuisine: 'Chinese royal court', neighborhood: 'Temple City', tier: 'drive',
    editorial: ['bistro-nas'] },
  { name: 'Morihiro', aliases: ['morihiro'],
    cuisine: 'Sushi', neighborhood: 'Atwater Village', tier: 'drive',
    editorial: ['morihiro'] },
  { name: 'Restaurant Ki', aliases: ['restaurant ki'],
    cuisine: 'French-Japanese', neighborhood: 'Beverly Hills area', tier: 'drive',
    editorial: ['restaurant-ki'] },
  { name: 'Langer\u2019s Delicatessen', aliases: ["langer's", 'langers'],
    cuisine: 'Jewish deli (pastrami)', neighborhood: 'MacArthur Park', tier: 'drive',
    editorial: ["langer-s-delicatessen", 'langers-delicatessen'] },
  { name: 'Howlin\u2019 Ray\u2019s', aliases: ['howlin rays', "howlin' ray's"],
    cuisine: 'Nashville hot chicken', neighborhood: 'Chinatown', tier: 'drive',
    editorial: ['howlin-ray-s-hot-chicken', 'howlin-ray-s'] },
  { name: 'Republique', aliases: ['republique', 'république'],
    cuisine: 'Bakery + French-Californian', neighborhood: 'Mid-City', tier: 'drive' },
  { name: 'Sushi Sonagi', aliases: ['sushi sonagi'],
    cuisine: 'Sushi', neighborhood: 'Gardena', tier: 'drive',
    editorial: ['sushi-sonagi'] },
  { name: 'Quarter Sheets Pizza Club', aliases: ['quarter sheets'],
    cuisine: 'Detroit-style pizza', neighborhood: 'Echo Park', tier: 'drive',
    editorial: ['quarter-sheets-pizza-club', 'quarter-sheets'] },
  { name: 'Osteria Mozza', aliases: ['osteria mozza'],
    cuisine: 'Italian (Nancy Silverton)', neighborhood: 'Hancock Park', tier: 'drive',
    editorial: ['osteria-mozza'] },
];

// ── Build entries ──
function buildEntry(pick) {
  const id = slugify(pick.name);
  const editorial = findEditorial(id, pick.editorial || pick.aliases || []);
  const sources = [];
  const rawDescs = {};

  // Editorial sources
  const articles = [
    ['eater_la38', editorial.eater_la38, SOURCE_ARTICLES.eater_la38],
    ['latimes_101', editorial.latimes_101, SOURCE_ARTICLES.latimes_101],
    ['infatuation_la25', editorial.infatuation_la25, SOURCE_ARTICLES.infatuation_la25],
    ['infatuation_westwood', editorial.infatuation_westwood, SOURCE_ARTICLES.infatuation_westwood],
    ['infatuation_westside', editorial.infatuation_westside, SOURCE_ARTICLES.infatuation_westside],
  ];
  for (const [key, match, art] of articles) {
    if (!match) continue;
    const type = key.startsWith('eater') ? 'eater'
      : key.startsWith('infatuation') ? 'infatuation'
      : key.startsWith('latimes') ? 'newspaper'
      : key;
    sources.push({ type, detail: art.detail, url: art.url, rank: match.index || null });
    if (match.body) rawDescs[key] = unesc(match.body);
  }
  if (editorial.michelin) {
    sources.push({ type: 'michelin', detail: SOURCE_ARTICLES.michelin.detail, url: SOURCE_ARTICLES.michelin.url, distinction: editorial.michelin.distinction || null });
  }

  // Reddit source with snippets + valence
  const { matches, threadsHit } = redditMatchesFor(pick.name, pick.aliases || []);
  if (threadsHit.length > 0) {
    const valence = computeValence(matches);
    sources.push({
      type: 'reddit',
      detail: `r/FoodLosAngeles — ${threadsHit.length} thread${threadsHit.length === 1 ? '' : 's'}`,
      threads: threadsHit.map(t => ({ title: t.title, url: t.url })),
      mentions: threadsHit.length,
      valence,
      snippets: matches.map(m => ({ threadTitle: m.threadTitle, threadUrl: m.threadUrl, score: m.score, text: m.text })),
    });
  }

  // Highlights
  let highlights = handCrafted[id] || null;
  if (!highlights) {
    const fallback = rawDescs.infatuation_westwood || rawDescs.infatuation_la25 || rawDescs.eater_la38 || rawDescs.latimes_101 || rawDescs.infatuation_westside;
    if (fallback) highlights = sentenceTruncate(fallback, 550);
    else highlights = `${pick.cuisine} — ${pick.neighborhood}. Crowd pick from r/FoodLosAngeles.`;
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
    tier: pick.tier,
    notes: null,
    sources,
    _rawDescs: rawDescs,
  };
}

const out = PICKS.map(buildEntry);

// Preserve raw descriptions in a side-file for Pass 2 composition
writeFileSync(
  resolve(REPO_ROOT, 'trips/places/los-angeles-compose-input.json'),
  JSON.stringify(out, null, 2)
);

// Drop _rawDescs from the upsert payload
for (const e of out) delete e._rawDescs;

// Sort: Michelin-worthy first, then Westwood/Westside tier, then by source count
const TIER_ORDER = { 'ucla-walkable': 0, 'sawtelle': 1, 'westside': 2, 'drive': 3 };
out.sort((a, b) => {
  const ta = TIER_ORDER[a.tier] ?? 99;
  const tb = TIER_ORDER[b.tier] ?? 99;
  if (ta !== tb) return ta - tb;
  if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
  return a.name.localeCompare(b.name);
});

const outPath = resolve(REPO_ROOT, 'trips/places/los-angeles-full.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`Wrote ${out.length} entries → ${outPath}`);
console.log(`Editorial counts: eater=${eater38.length} latimes=${latimes101.length} inf25=${infLa25.length} westwood=${infWw.length} westside=${infWs.length} michelin=${michelin.length}`);
console.log(`Reddit threads: ${REDDIT_THREADS.length}`);
console.log(`Multi-source (≥2): ${out.filter(e => e.sources.length >= 2).length}`);
console.log(`With Reddit: ${out.filter(e => e.sources.some(s => s.type === 'reddit')).length}`);
console.log(`With handcrafted description: ${out.filter(e => handCrafted[e.id]).length}/${out.length}`);
console.log('\nBy tier + sources:');
for (const e of out) {
  const red = e.sources.find(s => s.type === 'reddit');
  const redTag = red ? `reddit(${red.valence}, ${red.mentions}t)` : '';
  const types = e.sources.map(s => s.type === 'reddit' ? redTag : s.type).filter(Boolean).join(',');
  console.log(`  [${e.tier}] ${e.sources.length} | ${e.name.padEnd(34)} | ${types}`);
}
