// _places.mjs — Shared Google Places API (New) helpers.
//
// Design goals:
//   • Exactly one API call per row per enrichment run (single comprehensive
//     field mask covers rating, reviews, hours, price, location, photos,
//     outdoorSeating, etc.)
//   • Deterministic lookups on re-run: once we've got a placeId, we use the
//     /places/{id} resource-name endpoint (no more "Nina's Kitchen matched
//     the wrong Nina's" mistakes).
//   • Raw response cached on the row (data.placeRaw + data.placeRawFetchedAt)
//     so a future pipeline version that needs a new field can re-parse
//     locally instead of re-billing Google.
//
// All callers (enrich-group-combined.mjs and legacy single-purpose enrichers
// if/when they're migrated) should go through fetchPlace() so the cache and
// cost-accounting stay honest.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── API key (server-side only, from .env) ──
let _apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!_apiKey) {
  try {
    const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const m = env.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (m) _apiKey = m[1].trim();
  } catch {}
}
if (!_apiKey) throw new Error('No GOOGLE_MAPS_API_KEY in env or .env');
export const API_KEY = _apiKey;

// Field mask used by both Text Search (places.*) and Place Details (no prefix).
const FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'currentOpeningHours',
  'priceLevel',
  'priceRange',
  'reviews',
  'outdoorSeating',
  'photos',
  'types',
  'websiteUri',
];
export const SEARCH_FIELD_MASK = FIELDS.map(f => `places.${f}`).join(',');
export const DETAILS_FIELD_MASK = FIELDS.join(',');

// Cache TTL: re-parse from cached raw if <90 days old. After that, we refresh
// to pick up rating drift, hours changes, etc.
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function isFresh(fetchedAtIso) {
  if (!fetchedAtIso) return false;
  const t = Date.parse(fetchedAtIso);
  return Number.isFinite(t) && (Date.now() - t) < CACHE_TTL_MS;
}

// ── Raw API calls ──

async function searchTextOne(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  if (!res.ok) throw new Error(`searchText ${res.status} ${await res.text().catch(() => '')}`);
  const j = await res.json();
  return j.places?.[0] || null;
}

async function detailsByResourceName(placeId) {
  // placeId is just "ABC123" — the resource name is "places/ABC123".
  const name = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
  const res = await fetch(`https://places.googleapis.com/v1/${name}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });
  if (!res.ok) throw new Error(`details ${res.status} ${await res.text().catch(() => '')}`);
  return await res.json();
}

// Normalize a restaurant name for match verification — strip accents,
// punctuation, apostrophes, possessives, and pluralizing s so "Jon & Vinny's"
// matches "Jon and Vinnys". Keeps single tokens for a token-set comparison.
function nameTokens(s) {
  if (!s) return new Set();
  const raw = String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const stopwords = /^(the|a|an|and|of|at|in|on|de|la|le|el|restaurant|cafe|kitchen|bar|bistro|grill|los|angeles)$/i;
  // Multi-char content tokens are the primary signal.
  const tokens = new Set(raw.filter(t => t.length > 1 && !stopwords.test(t)));
  // If filtering leaves nothing (e.g. "A.O.C." → tokens "a o c"), fall back
  // to the full-name string as a single signal so we don't accidentally
  // reject every initialism. We also include the joined initialism so
  // "A.O.C." can compare against "AOC".
  if (tokens.size === 0) {
    const compact = raw.join('');
    if (compact.length >= 2) tokens.add(compact);
  }
  return tokens;
}

// Verify that a Places-returned place is plausibly the restaurant we asked
// for. We check that the Places displayName shares at least one significant
// token with our intended name. Returns { ok, reason, jaccard } so callers
// can decide whether to use the match or warn.
//
// Why: the Text Search endpoint silently returns its best guess even when
// the query is ambiguous (a wrong-neighborhood hint can pull up a totally
// different venue — see L20, L13 for "Restaurant Ki → Nua" and "Nina's
// Kitchen (Indian) → Nina's Kitchen (Salvadorian)" incidents).
export function verifyNameMatch(intendedName, place) {
  const got = place?.displayName?.text || '';
  const wantTokens = nameTokens(intendedName);
  const gotTokens = nameTokens(got);
  if (!wantTokens.size || !gotTokens.size) {
    return { ok: false, reason: 'empty tokens', jaccard: 0, gotName: got };
  }
  const intersection = new Set([...wantTokens].filter(t => gotTokens.has(t)));
  const union = new Set([...wantTokens, ...gotTokens]);
  const jaccard = intersection.size / union.size;
  // Require at least one content-token overlap. The Jaccard threshold is
  // lax on purpose (~0.2) because restaurant names vary ("The 18 Best" vs.
  // "Bestia"), but ZERO overlap is a strong red flag.
  const ok = intersection.size >= 1;
  return { ok, reason: ok ? 'match' : 'no shared tokens', jaccard, gotName: got };
}

// fetchPlace — central entry point for all Places lookups during enrichment.
//
//   row:    the group_restaurants.data object (we read placeId + placeRaw,
//           write placeId/placeRaw/placeRawFetchedAt on it)
//   query:  fallback textQuery if we have no placeId yet (typically
//           `<name> <address>` or `<name> <city>`)
//   force:  bypass the cache and refetch
//   intendedName: used to validate the match — if the returned place's
//           displayName shares no tokens with intendedName, we REFUSE to
//           commit the placeId/raw so the next run won't reuse the bad
//           match (and the caller is told).
//
// Returns { place, source, match } where source ∈ {'cache', 'details', 'search'}
// and match is the result of verifyNameMatch (or undefined on cache hits, where
// we've already validated at commit-time). Returns { place: null } if nothing
// matched.
export async function fetchPlace({ row, query, intendedName, force = false }) {
  // 1. Cache hit — use stored raw if fresh and not forced.
  if (!force && row.placeRaw && isFresh(row.placeRawFetchedAt)) {
    return { place: row.placeRaw, source: 'cache' };
  }
  // 2. Deterministic refresh via placeId if we have one.
  if (row.placeId) {
    try {
      const place = await detailsByResourceName(row.placeId);
      row.placeRaw = place;
      row.placeRawFetchedAt = new Date().toISOString();
      return { place, source: 'details' };
    } catch (e) {
      process.stderr.write(`  details by id failed (${e.message}); falling back to text search\n`);
    }
  }
  // 3. First-time text search. Validate the match before committing.
  const place = await searchTextOne(query);
  if (!place) return { place: null, source: 'search' };

  const match = intendedName ? verifyNameMatch(intendedName, place) : { ok: true };
  if (!match.ok) {
    // Don't commit placeId/raw — return the candidate so the caller can log
    // and decide. The caller should NOT use this place's data blindly.
    return { place, source: 'search', match };
  }
  row.placeId = place.id || null;
  row.placeRaw = place;
  row.placeRawFetchedAt = new Date().toISOString();
  return { place, source: 'search', match };
}

// ── Parsers (ported from enrich-group-details.mjs + enrich-group-geocode.mjs) ──

export function parseLocation(place) {
  const loc = place?.location;
  if (!loc) return null;
  // Places API (New) uses latitude/longitude; older APIs use lat/lng.
  const lat = loc.latitude ?? loc.lat ?? null;
  const lng = loc.longitude ?? loc.lng ?? null;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export function parseHours(place) {
  const hours = place?.regularOpeningHours || place?.currentOpeningHours;
  if (!hours) return null;
  const out = { weekdayText: hours.weekdayDescriptions || [], periods: [] };
  if (hours.periods) {
    for (const p of hours.periods) {
      out.periods.push({
        day: p.open?.day,
        open: p.open?.hour != null
          ? `${String(p.open.hour).padStart(2, '0')}:${String(p.open.minute || 0).padStart(2, '0')}`
          : null,
        close: p.close?.hour != null
          ? `${String(p.close.hour).padStart(2, '0')}:${String(p.close.minute || 0).padStart(2, '0')}`
          : null,
      });
    }
  }
  return out;
}

// Approximate currency → USD conversion for price-range bucketing. Precision
// to the cent doesn't matter; we're slotting into four $-tiers.
const TO_USD = {
  USD: 1.00, EUR: 1.10, GBP: 1.27, CHF: 1.12, CAD: 0.73, AUD: 0.66, NZD: 0.61,
  JPY: 0.0067, KRW: 0.00072, CNY: 0.14, HKD: 0.13, SGD: 0.74, TWD: 0.031,
  MXN: 0.059, BRL: 0.19, ARS: 0.0012,
  INR: 0.012, THB: 0.029, VND: 0.000039, IDR: 0.000061, PHP: 0.018, MYR: 0.21,
  AED: 0.27, SAR: 0.27, ILS: 0.27, TRY: 0.029, ZAR: 0.054, EGP: 0.020,
  NOK: 0.093, SEK: 0.095, DKK: 0.148, PLN: 0.25, CZK: 0.044, HUF: 0.0028, RON: 0.22,
};
const PRICE_THRESHOLDS_USD = [
  { max: 16, tier: '$' },
  { max: 33, tier: '$$' },
  { max: 77, tier: '$$$' },
  { max: Infinity, tier: '$$$$' },
];
function priceRangeToTier(range) {
  const start = range?.startPrice;
  if (!start?.units) return null;
  const currency = start.currencyCode || 'USD';
  const rate = TO_USD[currency] ?? 1.0;
  const usd = Number(start.units) * rate;
  if (!Number.isFinite(usd)) return null;
  return PRICE_THRESHOLDS_USD.find(t => usd < t.max)?.tier || '$$$$';
}
const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: '$',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};
export function parsePrice(place) {
  // priceRange is newer and monetary-accurate; priceLevel enum is stale for
  // many fine-dining places (ABaC was reported INEXPENSIVE on a €260 menu).
  const fromRange = priceRangeToTier(place?.priceRange);
  if (fromRange) return fromRange;
  const raw = place?.priceLevel;
  if (!raw) return null;
  return PRICE_LEVEL_MAP[raw] || null;
}

export function parseReviews(place) {
  const list = place?.reviews;
  if (!Array.isArray(list) || !list.length) return null;
  return list
    .filter(r => r?.text?.text?.trim().length > 20)
    .map(r => ({
      author: r.authorAttribution?.displayName || 'Anonymous',
      rating: r.rating || null,
      text: r.text.text.trim(),
      time: r.relativePublishTimeDescription || null,
    }))
    .slice(0, 5);
}

export function parseOutdoorSeating(place) {
  // null if Google has no opinion; Boolean otherwise.
  if (place == null) return null;
  if (typeof place.outdoorSeating === 'boolean') return place.outdoorSeating;
  return null;
}

// Extract photo resource names (refs) so the caller can download + upload
// to Supabase Storage in one pass.
export function parsePhotoRefs(place, max = 5) {
  const photos = place?.photos;
  if (!Array.isArray(photos) || !photos.length) return [];
  return photos.slice(0, max).map(p => p.name).filter(Boolean);
}

export function googlePhotoUrl(photoRef, { maxWidthPx = 400 } = {}) {
  return `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${maxWidthPx}&key=${API_KEY}`;
}
