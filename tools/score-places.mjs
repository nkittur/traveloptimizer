#!/usr/bin/env node
// score-places: Score nearby places against family preferences, output interactive HTML
// Usage: node tools/score-places.mjs <places.json>
//    or: node tools/nearby-places.mjs "query" "location" | node tools/score-places.mjs
//
// Reads profile/family.json for preference matching.
// Outputs a mobile-first HTML with interactive map + scored cards with query-specific insights.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// --- Load API key ---
let API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  try {
    const envFile = readFileSync(resolve(REPO_ROOT, '.env'), 'utf-8');
    const match = envFile.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) API_KEY = match[1].trim();
  } catch {}
}

// --- Load profile ---
let profile;
try {
  profile = JSON.parse(readFileSync(resolve(REPO_ROOT, 'profile/family.json'), 'utf-8'));
} catch {
  console.error('Warning: Could not read profile/family.json');
  profile = {};
}

// --- Read input ---
let input;
const inputFile = process.argv[2];
if (inputFile) {
  input = readFileSync(inputFile, 'utf-8');
} else {
  input = readFileSync('/dev/stdin', 'utf-8');
}

const data = JSON.parse(input);
if (!data.places || !Array.isArray(data.places)) {
  console.error('Invalid input: expected { places: [...] }');
  process.exit(1);
}

// --- Parse query intent ---
// Extract what the user is actually looking for from the query
function parseQueryIntent(query) {
  const q = (query || '').toLowerCase();
  const intents = [];

  const intentMap = [
    { keywords: ['outdoor', 'patio', 'outside', 'terrace', 'garden'], intent: 'outdoor', label: 'Outdoor seating', field: 'outdoor_seating' },
    { keywords: ['beer', 'brew', 'tap', 'draft', 'ale', 'ipa'], intent: 'beer', label: 'Beer', field: 'serves_beer' },
    { keywords: ['coffee', 'cafe', 'café', 'espresso', 'latte'], intent: 'coffee', label: 'Coffee', field: 'serves_coffee' },
    { keywords: ['cocktail', 'drinks', 'bar', 'mixology'], intent: 'cocktails', label: 'Cocktails', field: 'serves_cocktails' },
    { keywords: ['wine', 'vineyard', 'vino'], intent: 'wine', label: 'Wine', field: 'serves_wine' },
    { keywords: ['music', 'live', 'entertainment', 'band'], intent: 'music', label: 'Live music', field: 'live_music' },
    { keywords: ['dog', 'pet'], intent: 'dogs', label: 'Dog-friendly', field: 'allows_dogs' },
    { keywords: ['food', 'eat', 'restaurant', 'dinner', 'lunch', 'brunch', 'bite'], intent: 'food', label: 'Food', field: null },
  ];

  for (const im of intentMap) {
    if (im.keywords.some(kw => q.includes(kw))) {
      intents.push(im);
    }
  }

  return intents;
}

// --- Score and annotate each place ---
function haversine(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function scorePlaces(places, locationBias, intents) {
  const distances = places.map(p => haversine(locationBias, p.location));

  // Determine a reasonable "threshold" distance — within this, proximity barely matters
  // Use the 75th percentile distance as the threshold (~15-20 min for most urban searches)
  const sortedDists = distances.filter(d => d < Infinity).sort((a, b) => a - b);
  const thresholdDist = sortedDists[Math.floor(sortedDists.length * 0.75)] || 10;
  const maxDist = Math.max(...sortedDists) || 1;

  return places.map((p, i) => {
    const dist = distances[i];
    const distKm = dist < Infinity ? Math.round(dist * 10) / 10 : null;
    const driveMin = distKm != null ? Math.round(distKm * 1.5) : null;

    // --- Intent match (does it have what you asked for?) ---
    const intentResults = [];
    let intentScore = 0;
    let intentCount = 0;

    for (const intent of intents) {
      if (intent.field) {
        const val = p[intent.field];
        const hit = val === true;
        const miss = val === false;
        const unknown = val === null || val === undefined;
        intentResults.push({ ...intent, hit, miss, unknown });
        intentScore += hit ? 1 : miss ? 0 : 0.3;
        intentCount++;
      }
    }

    const intentMatch = intentCount > 0 ? intentScore / intentCount : 0.5;

    // --- Quality: combines rating credibility + destination-worthiness ---
    //
    // Three insights:
    // 1. A 4.6 with 600 reviews >> 5.0 with 29 reviews (Bayesian credibility)
    // 2. Above ~4.3, rating differences are mostly noise — compress them
    // 3. High review volume signals "destination-worthy" — people go out of their
    //    way to visit. This is a separate signal from rating.
    //
    // Bayesian rating: pulls low-review places toward the mean
    const C = 4.5;  // prior
    const m = 100;   // credibility threshold
    const R = p.rating || C;
    const v = p.review_count || 0;
    const bayesianRating = (R * v + C * m) / (v + m);

    // Compress the rating scale: above 4.3 is "good", differences are small
    // Map 3.5-5.0 → 0-1 but with diminishing returns above 4.3
    let ratingScore;
    if (bayesianRating < 4.0) ratingScore = 0.2;
    else if (bayesianRating < 4.3) ratingScore = 0.2 + 0.3 * ((bayesianRating - 4.0) / 0.3);
    else ratingScore = 0.5 + 0.5 * Math.min(1, (bayesianRating - 4.3) / 0.5); // 4.3→0.5, 4.8→1.0, compressed

    // Destination signal: how many people bother to review this place?
    // Log scale, normed against the set. 600 reviews >> 29 reviews.
    const maxReviews = Math.max(...places.map(p => p.review_count || 0));
    const destScore = v > 0 ? Math.log(v + 1) / Math.log(maxReviews + 1) : 0;

    // Combined quality = 60% rating credibility + 40% destination signal
    const qualityScore = ratingScore * 0.6 + destScore * 0.4;

    // --- Proximity: plateau within threshold, then gentle decay ---
    // Everything within ~75th percentile distance scores 0.9-1.0
    // Beyond that, gentle linear decay
    let proxScore;
    if (dist >= Infinity) {
      proxScore = 0;
    } else if (dist <= thresholdDist * 0.5) {
      // Very close: score 1.0
      proxScore = 1.0;
    } else if (dist <= thresholdDist) {
      // Within threshold: score 0.85-1.0 (barely differentiated)
      proxScore = 1.0 - 0.15 * ((dist - thresholdDist * 0.5) / (thresholdDist * 0.5));
    } else {
      // Beyond threshold: 0.85 decaying to 0 at 2x threshold
      proxScore = Math.max(0, 0.85 * (1 - (dist - thresholdDist) / thresholdDist));
    }

    // --- Overall: quality matters most, intent is pass/fail, proximity is tiebreaker ---
    // When intent match is uniform (all 1.0), quality should dominate.
    // When intent match varies, it should be decisive.
    const intentVariance = intentMatch < 0.9 ? 0.4 : 0.1; // dynamic weight
    const overall = intentMatch * intentVariance + qualityScore * 0.6 + proxScore * (0.4 - intentVariance);

    // Categorize match type
    const hitCount = intentResults.filter(r => r.hit).length;
    const missCount = intentResults.filter(r => r.miss).length;
    let matchType, matchLabel;
    if (hitCount === intentResults.length) {
      matchType = 'perfect'; matchLabel = 'Exactly what you want';
    } else if (missCount === 0) {
      matchType = 'likely'; matchLabel = 'Probably good';
    } else if (hitCount > missCount) {
      matchType = 'partial'; matchLabel = 'Partial match';
    } else {
      matchType = 'alternative'; matchLabel = 'Different vibe';
    }

    // Build WHY lines (specific to query)
    const pros = [];
    const cons = [];

    // Distance insight
    if (distKm != null) {
      if (distKm < 2) pros.push(driveMin <= 1 ? 'Walking distance' : driveMin + ' min drive');
      else if (distKm < 5) pros.push(driveMin + ' min drive');
      else cons.push(driveMin + ' min away');
    }

    // Intent-specific insights
    for (const ir of intentResults) {
      if (ir.hit) pros.push(ir.label);
      else if (ir.miss) cons.push('No ' + ir.label.toLowerCase());
    }

    // Rating insight
    if (p.rating >= 4.6) pros.push('Highly rated (' + p.rating + ')');
    else if (p.rating && p.rating < 4.0) cons.push('Lower rated (' + p.rating + ')');

    // Description-based insight (use the editorial summary if it adds color)
    if (p.description) {
      // Extract the most interesting phrase from description
      const desc = p.description;
      if (desc.length < 80) pros.push(desc);
    }

    // Open/closed
    let closingTime = null;
    if (p.open_now === false) cons.push('Currently closed');
    if (p.open_now === true && p.today_hours) {
      const closeMatch = p.today_hours.match(/(\d+:\d+\s*(?:AM|PM))\s*$/i);
      if (closeMatch) {
        closingTime = closeMatch[1];
        pros.push('Open until ' + closingTime);
      }
    }

    // --- Build narrative ---
    // A cohesive 1-3 sentence summary of why this place does or doesn't fit
    const narParts = [];

    // Opening: what is this place + distance
    const typeStr = p.type ? p.type : 'spot';
    if (p.description) {
      // Use the editorial summary as the lead
      narParts.push(p.description.replace(/\.$/, ''));
    } else {
      narParts.push(p.name + ' is a ' + typeStr.toLowerCase());
    }

    // Distance context
    if (driveMin != null && driveMin <= 2) {
      narParts[0] += ', just ' + (driveMin <= 1 ? 'steps' : driveMin + ' min') + ' from your location';
    } else if (driveMin != null && driveMin <= 10) {
      narParts[0] += ', about ' + driveMin + ' min away';
    } else if (driveMin != null) {
      narParts[0] += ', but ' + driveMin + ' min away';
    }
    narParts[0] += '.';

    // What matches the query
    const hits = intentResults.filter(r => r.hit).map(r => r.label.toLowerCase());
    const misses = intentResults.filter(r => r.miss).map(r => r.label.toLowerCase());

    if (hits.length > 0) {
      narParts.push('Has ' + hits.join(', ') + '.');
    }
    if (misses.length > 0) {
      narParts.push('Missing: ' + misses.join(', ') + '.');
    }

    // Quality + hours context
    const qualParts = [];
    if (p.rating) qualParts.push('rated ' + p.rating + (p.review_count ? ' (' + p.review_count.toLocaleString() + ' reviews)' : ''));
    if (closingTime) qualParts.push('open until ' + closingTime + ' today');
    else if (p.open_now === false) qualParts.push('currently closed');
    if (qualParts.length) {
      narParts.push(qualParts.map((s, i) => i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s).join(', ') + '.');
    }

    const narrative = narParts.join(' ');

    return {
      ...p,
      _distKm: distKm,
      _driveMin: driveMin,
      _overall: overall,
      _matchType: matchType,
      _matchLabel: matchLabel,
      _pros: pros,
      _cons: cons,
      _narrative: narrative,
      _intentResults: intentResults,
    };
  }).sort((a, b) => b._overall - a._overall);
}

const intents = parseQueryIntent(data.query);
const scored = scorePlaces(data.places, data.location_bias, intents);

// --- Generate personalized narratives via Claude ---
// --- Load prior narratives from indexed store ---
function loadPriorNarratives(locationBias) {
  const PLACES_DIR = resolve(REPO_ROOT, 'trips', 'places');
  const INDEX_FILE = resolve(PLACES_DIR, 'index.json');
  const priorByName = {}; // { normalized_name: { narrative, query, ... } }

  let index = [];
  try { index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8')); } catch { return priorByName; }

  for (const entry of index) {
    // Check if this entry is geographically close (within ~5km)
    if (entry.location_bias && locationBias) {
      const dlat = Math.abs(entry.location_bias.lat - locationBias.lat);
      const dlng = Math.abs(entry.location_bias.lng - locationBias.lng);
      if (dlat > 0.05 || dlng > 0.06) continue; // ~5km threshold
    }

    try {
      const filePath = resolve(PLACES_DIR, entry.file);
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      for (const place of (data.places || [])) {
        if (place.narrative && place.name) {
          const key = place.name.toLowerCase().trim();
          // Keep the most recent narrative for each place
          if (!priorByName[key] || new Date(data.generated_at) > new Date(priorByName[key].generated_at)) {
            priorByName[key] = {
              narrative: place.narrative,
              query: data.query,
              generated_at: data.generated_at,
            };
          }
        }
      }
    } catch {}
  }

  console.error(`Loaded ${Object.keys(priorByName).length} prior narratives from nearby searches`);
  return priorByName;
}

async function generateNarratives(scored, profile, query, locationBias, groupContext) {
  const priorNarratives = loadPriorNarratives(locationBias);

  const placeSummaries = scored.map((p, i) => {
    const entry = {
      index: i,
      name: p.name,
      type: p.type,
      description: p.description,
      rating: p.rating,
      review_count: p.review_count,
      address: p.address,
      outdoor_seating: p.outdoor_seating,
      serves_beer: p.serves_beer,
      serves_coffee: p.serves_coffee,
      serves_cocktails: p.serves_cocktails,
      serves_wine: p.serves_wine,
      live_music: p.live_music,
      allows_dogs: p.allows_dogs,
      today_hours: p.today_hours,
      open_now: p.open_now,
      _distKm: p._distKm,
      _driveMin: p._driveMin,
      _matchType: p._matchType,
      _overall: Math.round(p._overall * 100),
    };

    // Attach web research if available
    if (p.web_research) entry.web_research = p.web_research;

    // Attach prior narrative if we have one
    const key = (p.name || '').toLowerCase().trim();
    if (priorNarratives[key]) {
      entry._prior_narrative = priorNarratives[key].narrative;
      entry._prior_query = priorNarratives[key].query;
    }

    return entry;
  });

  const hasPriors = placeSummaries.some(p => p._prior_narrative);

  // Determine who is in this group
  let groupSection = '';
  if (groupContext) {
    groupSection = `\n## Who's Going
Members: ${groupContext.members.join(', ')}${groupContext.not_included ? '\nNOT included: ' + groupContext.not_included.join(', ') : ''}
${groupContext.context || ''}
${groupContext.friend_profiles ? '\n### Friend Profiles\n' + Object.entries(groupContext.friend_profiles).map(([k,v]) => k + ': ' + v).join('\n') : ''}

IMPORTANT: Write narratives ONLY for the people going (${groupContext.members.join(', ')}). Do NOT reference ${(groupContext.not_included || []).join(', ')} in narratives.\n`;
  }

  const prompt = `You are writing personalized place recommendations.

## Family Profile
${JSON.stringify(profile, null, 2)}
${groupSection}
## Their Query (what they're looking for RIGHT NOW)
"${query}"

## Places to Write About
${JSON.stringify(placeSummaries, null, 2)}
${hasPriors ? `
## Prior Context
Some places have a _prior_narrative from a previous search. Use these as context but REWRITE for the current query and current group.` : ''}

For each place (by index), write a 1-3 sentence personalized narrative explaining why THIS GROUP would or wouldn't enjoy it for THIS SPECIFIC QUERY. Reference people by name when relevant.

Rules:
- Be specific to why this place fits or doesn't fit THEIR CURRENT QUERY: "${query}"
- Reference actual family member preferences by name (Carissa's love of vintage bars, Ashi's steak/no-cheese, Niki's coasts, etc.)
- Mention what DOESN'T match too — be honest about tradeoffs
- Include practical context: distance, hours, what makes it good or bad for RIGHT NOW
- Don't repeat the place name at the start — the UI already shows it
- Keep it conversational and opinionated, like a knowledgeable friend
- If you have a prior narrative, use the knowledge from it but reframe for the current query
- If a place has no description and no prior, say so honestly

Return ONLY a JSON array: [{"index": 0, "narrative": "..."}, {"index": 1, "narrative": "..."}, ...]
No markdown, no backticks, just the JSON array.`;

  try {
    console.error('Generating personalized narratives via Claude...');
    const result = execSync(
      `claude -p ${JSON.stringify(prompt)} 2>/dev/null`,
      { maxBuffer: 1024 * 1024, timeout: 90000 }
    ).toString().trim();

    let narratives;
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      narratives = JSON.parse(jsonMatch[0]);
    } else {
      console.error('Could not parse narrative response');
      console.error('Raw output (first 500 chars):', result.substring(0, 500));
      return null;
    }

    return narratives;
  } catch (err) {
    console.error('Narrative generation failed:', err.message);
    return null;
  }
}

// Run narrative generation
const narratives = await generateNarratives(scored, profile, data.query, data.location_bias, data.group || null);
if (narratives) {
  for (const n of narratives) {
    if (n.index != null && scored[n.index]) {
      scored[n.index]._narrative = n.narrative;
    }
  }
  console.error(`Generated ${narratives.length} personalized narratives`);
}

// --- Save enriched JSON to indexed places store ---
const PLACES_DIR = resolve(REPO_ROOT, 'trips', 'places');
const INDEX_FILE = resolve(PLACES_DIR, 'index.json');

// Generate a slug from location + query keywords
function makeSlug(query, locationBias) {
  const q = (query || '').toLowerCase();
  // Extract location name (before "near" keyword or from the end)
  const locMatch = q.match(/near\s+(.+?)(?:\s+\d{5})?$/i);
  const locStr = locMatch ? locMatch[1] : '';
  // Extract intent keywords (not location words)
  const stopWords = new Set(['near', 'in', 'at', 'the', 'a', 'an', 'with', 'and', 'or', 'for', 'pa', 'oh', 'ca', 'ny']);
  const locWords = new Set(locStr.split(/\s+/));
  const intentWords = q.replace(/near\s+.+$/i, '').split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w) && !locWords.has(w))
    .slice(0, 4);
  // Build slug: location-keywords-zip
  const locSlug = locStr.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const intentSlug = intentWords.join('-').replace(/[^a-z0-9-]+/g, '');
  // Try to extract zip from query or reverse-geocode from lat/lng
  const zipMatch = q.match(/\b(\d{5})\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const parts = [locSlug, intentSlug, zip].filter(Boolean);
  return parts.join('-') || 'unknown';
}

const slug = makeSlug(data.query, data.location_bias);
const jsonOutFile = resolve(PLACES_DIR, slug + '.json');

const placeRecord = {
  query: data.query,
  slug,
  location_bias: data.location_bias,
  intents: intents.map(i => ({ intent: i.intent, label: i.label, field: i.field })),
  generated_at: new Date().toISOString(),
  places: scored.map(p => ({
    name: p.name, type: p.type, description: p.description, address: p.address,
    full_address: p.full_address, rating: p.rating, review_count: p.review_count,
    outdoor_seating: p.outdoor_seating, serves_beer: p.serves_beer,
    serves_coffee: p.serves_coffee, serves_cocktails: p.serves_cocktails,
    live_music: p.live_music, allows_dogs: p.allows_dogs, open_now: p.open_now,
    today_hours: p.today_hours, google_maps_url: p.google_maps_url, website: p.website,
    location: p.location,
    score: Math.round(p._overall * 100),
    match_type: p._matchType,
    narrative: p._narrative,
    distance_km: p._distKm,
    drive_min: p._driveMin,
    evidence: p.evidence || [],
    photos: p.photos || [],
    social_links: p.social_links || null,
  }))
};

writeFileSync(jsonOutFile, JSON.stringify(placeRecord, null, 2));
console.error(`Saved: ${jsonOutFile}`);

// Update index
let index = [];
try { index = JSON.parse(readFileSync(INDEX_FILE, 'utf-8')); } catch {}
// Remove existing entry for same slug
index = index.filter(e => e.slug !== slug);
// Add new entry
index.push({
  slug,
  file: slug + '.json',
  query: data.query,
  location_bias: data.location_bias,
  intents: intents.map(i => i.intent),
  place_count: scored.length,
  top_place: scored[0]?.name || null,
  generated_at: new Date().toISOString(),
});
writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
console.error(`Index updated: ${index.length} entries`);

// --- Build member profiles for the UI ---
const memberProfiles = {};
// From family.json members
for (const m of (profile.family?.members || [])) {
  memberProfiles[m.name] = { role: m.role, notes: m.notes };
}
// From friend_profiles in family.json
for (const [name, fp] of Object.entries(profile.friend_profiles || {})) {
  memberProfiles[name] = { role: 'friend', notes: fp.notes, drinks: fp.drinks, vibe: fp.vibe };
}
// Override/merge from group context friend_profiles (may have shorter descriptions)
if (data.group?.friend_profiles) {
  for (const [name, desc] of Object.entries(data.group.friend_profiles)) {
    if (!memberProfiles[name]) memberProfiles[name] = {};
    memberProfiles[name].role = memberProfiles[name].role || 'friend';
    // Don't overwrite richer family.json data with shorter group context
  }
}

// --- Build embedded data ---
const embeddedData = {
  scored,
  query: data.query,
  group: data.group || null,
  memberProfiles,
  locationBias: data.location_bias,
  intents: intents.map(i => ({ intent: i.intent, label: i.label, field: i.field })),
  apiKey: API_KEY,
};

// --- Generate HTML ---
function generateHTML(embedded) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Scored: ${(embedded.query || 'Places').replace(/"/g, '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'Inter',system-ui,sans-serif;background:#f0f4f8;color:#1a2332;line-height:1.5;overflow-x:hidden}

.header{background:linear-gradient(135deg,#1a3a5c 0%,#2a6496 50%,#3a85c4 100%);color:#fff;padding:16px 16px 12px;position:sticky;top:0;z-index:100}
.header h1{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.header .sub{font-size:12px;color:#a8cce8;margin-top:2px}
.intent-chips{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.intent-chip{font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;background:rgba(255,255,255,0.15);color:#e0ecf5;border:1px solid rgba(255,255,255,0.25)}

#map{width:100%;height:35vh;min-height:180px;background:#dde6ed}

.section-label{padding:12px 12px 4px;font-size:13px;font-weight:700;color:#1a3a5c;text-transform:uppercase;letter-spacing:0.5px}
.section-label .count{font-weight:400;color:#5a6b7d;text-transform:none;letter-spacing:0}

.card{background:#fff;border-radius:14px;padding:14px;margin:0 10px 10px;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.04);border:2px solid transparent;transition:border-color 0.15s;cursor:pointer}
.card.selected{border-color:#2a6496}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.card-name{font-size:15px;font-weight:700;color:#1a2332;flex:1}
.card-score{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
.card-meta{font-size:12px;color:#5a6b7d;margin-top:2px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.card-meta .dot{color:#d1d5db}
.card-meta .open{color:#059669;font-weight:600}
.card-meta .closed{color:#991b1b;font-weight:600}

.match-tag{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px;border-radius:6px;margin-top:6px}
.match-tag.perfect{background:#ecfdf5;color:#059669}
.match-tag.likely{background:#eff6ff;color:#1e40af}
.match-tag.partial{background:#fef9ee;color:#b45309}
.match-tag.alternative{background:#f3f4f6;color:#6b7280}

.insights{margin-top:8px;font-size:12px;line-height:1.6}
.pro{color:#059669}
.pro::before{content:'+';font-weight:700;margin-right:4px}
.con{color:#b45309}
.con::before{content:'-';font-weight:700;margin-right:4px}

.card-narrative{font-size:13px;color:#374151;margin-top:8px;line-height:1.55}

.photo-strip{display:flex;gap:6px;margin-top:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;scroll-snap-type:x mandatory}
.photo-strip img{height:110px;border-radius:8px;object-fit:cover;flex-shrink:0;scroll-snap-align:start}

.evidence{margin-top:8px}
.evidence-quote{font-size:12px;color:#374151;border-left:3px solid #2a6496;padding:4px 0 4px 10px;margin:6px 0;line-height:1.5;font-style:italic}
.evidence-quote .ev-tag{font-size:10px;font-weight:600;color:#2a6496;font-style:normal;margin-left:4px;background:#eff6ff;padding:1px 5px;border-radius:4px}
.evidence-attr{font-size:10px;color:#94a3b8;font-style:normal}

.action-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.action-link{font-size:11px;font-weight:600;color:#2a6496;text-decoration:none;padding:4px 10px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe;display:inline-flex;align-items:center;gap:3px}
.action-link:active{background:#dbeafe}

.card-addr{font-size:11px;color:#94a3b8;margin-top:6px}

/* Lightbox */
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:400;display:none;flex-direction:column;align-items:center;justify-content:center}
.lightbox.show{display:flex}
.lightbox-close{position:absolute;top:12px;right:16px;color:#fff;font-size:28px;cursor:pointer;z-index:401;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);border-radius:50%;border:none;font-family:inherit}
.lightbox-counter{position:absolute;top:16px;left:16px;color:rgba(255,255,255,0.6);font-size:13px;font-weight:600}
.lightbox-img-wrap{flex:1;display:flex;align-items:center;justify-content:center;width:100%;overflow:hidden;touch-action:pan-y}
.lightbox-img-wrap img{max-width:100%;max-height:85vh;object-fit:contain;border-radius:4px}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);color:#fff;font-size:32px;cursor:pointer;width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);border-radius:50%;border:none;font-family:inherit}
.lightbox-nav.prev{left:8px}
.lightbox-nav.next{right:8px}
.lightbox-dots{display:flex;gap:6px;padding:12px;justify-content:center}
.lightbox-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.3)}
.lightbox-dots span.active{background:#fff}

.summary{max-width:600px;margin:12px auto;padding:0 12px}
.ctx-card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.04);font-size:13px;line-height:2}
.ctx-label{font-weight:700;color:#1a3a5c;margin-right:4px}
.ctx-person{display:inline-block;font-weight:600;color:#1a2332;background:#f0f4f8;padding:1px 8px;border-radius:6px;margin-right:2px;cursor:pointer;border:1px solid #e5e7eb;-webkit-tap-highlight-color:rgba(42,100,150,0.2)}
.ctx-person:active{background:#e0ecf5}

.person-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:300;display:none;opacity:0;transition:opacity 0.15s}
.person-popup-overlay.show{display:block;opacity:1}
.person-popup{position:fixed;bottom:0;left:0;right:0;background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 32px;z-index:301;transform:translateY(100%);transition:transform 0.25s ease;max-height:60vh;overflow-y:auto}
.person-popup.show{transform:translateY(0)}
.person-popup .drag-handle{width:40px;height:4px;background:#d1d5db;border-radius:2px;margin:0 auto 14px}
.person-popup h3{font-size:18px;font-weight:700;color:#1a2332}
.person-popup .pp-role{font-size:12px;color:#5a6b7d;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
.person-popup .pp-notes{font-size:14px;color:#374151;margin-top:12px;line-height:1.6}
.person-popup .pp-detail{margin-top:10px;font-size:13px;color:#5a6b7d}
.person-popup .pp-detail span{font-weight:600;color:#1a3a5c}
.ctx-chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:#eff6ff;color:#1e40af;margin-right:2px}
.ctx-text{color:#5a6b7d}

.footer{text-align:center;padding:24px;font-size:11px;color:#94a3b8}

@media(min-width:641px){
  .card{margin:0 auto 10px;max-width:600px}
  .section-label{max-width:600px;margin:0 auto}
}
</style>
</head>
<body>

<div class="header">
  <h1 id="hTitle"></h1>
  <div class="sub" id="hSub"></div>
  <div class="intent-chips" id="hChips"></div>
</div>
<div id="map"></div>
<div id="summaryWrap" class="summary"></div>
<div id="content"></div>
<div class="person-popup-overlay" id="ppOverlay" onclick="closePersonPopup()"></div>
<div class="person-popup" id="ppPanel">
  <div class="drag-handle"></div>
  <div id="ppContent"></div>
</div>
<div class="lightbox" id="lightbox">
  <button class="lightbox-close" onclick="closeLightbox()">\\u00d7</button>
  <div class="lightbox-counter" id="lbCounter"></div>
  <button class="lightbox-nav prev" onclick="lbNav(-1)">\\u2039</button>
  <div class="lightbox-img-wrap" id="lbImgWrap"></div>
  <button class="lightbox-nav next" onclick="lbNav(1)">\\u203a</button>
  <div class="lightbox-dots" id="lbDots"></div>
</div>
<div class="footer">TravelOptimizer &middot; Scored via Google Places API</div>

<script>
const DATA = ${JSON.stringify(embedded, null, 0)};

// === INIT HEADER ===
document.getElementById('hTitle').textContent = DATA.query || 'Scored Places';
document.getElementById('hSub').textContent = DATA.scored.length + ' places scored';
const chips = document.getElementById('hChips');
DATA.intents.forEach(function(intent) {
  const c = document.createElement('span');
  c.className = 'intent-chip';
  c.textContent = intent.label;
  chips.appendChild(c);
});

// === QUERY CONTEXT ===
(function() {
  var wrap = document.getElementById('summaryWrap');
  var parts = [];
  var group = DATA.group;
  if (group && group.members) {
    parts.push('<span class="ctx-label">Who:</span> ' + group.members.map(function(m) {
      return '<span class="ctx-person" onclick="showPerson(&#39;' + m + '&#39;)">' + m + '</span>';
    }).join(' '));
  }
  if (DATA.intents && DATA.intents.length) {
    parts.push('<span class="ctx-label">Looking for:</span> ' + DATA.intents.map(function(i) { return '<span class="ctx-chip">' + i.label + '</span>'; }).join(' '));
  }
  if (group && group.context) {
    parts.push('<span class="ctx-label">Context:</span> <span class="ctx-text">' + group.context.replace(/</g,'&lt;') + '</span>');
  }
  if (parts.length) {
    wrap.innerHTML = '<div class="ctx-card">' + parts.join('<br>') + '</div>';
  }
})();

// === PERSON POPUP ===
function showPerson(name) {
  var p = (DATA.memberProfiles || {})[name];
  var html = '<h3>' + name + '</h3>';
  if (p) {
    if (p.role) html += '<div class="pp-role">' + p.role + '</div>';
    if (p.notes) html += '<div class="pp-notes">' + p.notes.replace(/</g,'&lt;') + '</div>';
    if (p.drinks && p.drinks.length) html += '<div class="pp-detail"><span>Drinks:</span> ' + p.drinks.join(', ') + '</div>';
    if (p.vibe) html += '<div class="pp-detail"><span>Vibe:</span> ' + p.vibe + '</div>';
  } else {
    html += '<div class="pp-notes">No profile info available.</div>';
  }
  document.getElementById('ppContent').innerHTML = html;
  document.getElementById('ppOverlay').classList.add('show');
  document.getElementById('ppPanel').classList.add('show');
}
function closePersonPopup() {
  document.getElementById('ppOverlay').classList.remove('show');
  document.getElementById('ppPanel').classList.remove('show');
}

// === LIGHTBOX ===
var lbPhotos = [];
var lbIndex = 0;

function openLightbox(photos, index) {
  lbPhotos = photos;
  lbIndex = index || 0;
  renderLightbox();
  document.getElementById('lightbox').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('show');
  document.body.style.overflow = '';
}

function lbNav(dir) {
  lbIndex = (lbIndex + dir + lbPhotos.length) % lbPhotos.length;
  renderLightbox();
}

function renderLightbox() {
  document.getElementById('lbImgWrap').innerHTML = '<img src="' + lbPhotos[lbIndex] + '" alt="">';
  document.getElementById('lbCounter').textContent = (lbIndex + 1) + ' / ' + lbPhotos.length;
  var dots = lbPhotos.map(function(_, i) {
    return '<span' + (i === lbIndex ? ' class="active"' : '') + '></span>';
  }).join('');
  document.getElementById('lbDots').innerHTML = dots;
}

// Swipe support for lightbox
(function() {
  var wrap = document.getElementById('lbImgWrap');
  var startX = 0;
  wrap.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; });
  wrap.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) lbNav(dx < 0 ? 1 : -1);
  });
  // Close on escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
  });
})();

// === HELPERS ===
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function scoreColor(s) { return 'hsl(' + (s * 120) + ',75%,42%)'; }
function haversine(a, b) {
  if (!a || !b) return Infinity;
  var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  var x = Math.pow(Math.sin(dLat/2),2) + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.pow(Math.sin(dLng/2),2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

var selectedIndex = 0;
var map = null;
var markers = [];

// === RENDER CARDS ===
function render() {
  var content = document.getElementById('content');
  content.innerHTML = '';

  // Group by match type
  var groups = { perfect: [], likely: [], partial: [], alternative: [] };
  DATA.scored.forEach(function(p, i) { (groups[p._matchType] || groups.alternative).push({ p: p, i: i }); });

  var labels = {
    perfect: 'Exactly what you asked for',
    likely: 'Probably a good fit',
    partial: 'Partial match',
    alternative: 'Different vibe but interesting'
  };

  var order = ['perfect', 'likely', 'partial', 'alternative'];
  var globalRank = 0;

  order.forEach(function(type) {
    var items = groups[type];
    if (!items.length) return;

    var label = document.createElement('div');
    label.className = 'section-label';
    label.innerHTML = labels[type] + ' <span class="count">(' + items.length + ')</span>';
    content.appendChild(label);

    items.forEach(function(item) {
      globalRank++;
      var p = item.p;
      var i = item.i;
      var card = document.createElement('div');
      card.className = 'card' + (selectedIndex === i ? ' selected' : '');
      card.id = 'place-' + i;
      card.onclick = function() { selectPlace(i); };

      var distStr = '';
      if (p._distKm != null) {
        distStr = p._distKm < 1 ? Math.round(p._distKm * 1000) + 'm' : p._distKm + 'km';
      }

      var mapsUrl = p.google_maps_url || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ' ' + (p.address || '')));

      card.innerHTML =
        '<div class="card-top">' +
          '<div>' +
            '<div class="card-name">' + globalRank + '. ' + esc(p.name) + '</div>' +
            '<div class="card-meta">' +
              (p.rating ? '<span style="font-weight:600">\\u2605 ' + p.rating + '</span><span class="dot">\\u00b7</span>' : '') +
              (p.review_count ? '<span>' + p.review_count.toLocaleString() + '</span><span class="dot">\\u00b7</span>' : '') +
              (distStr ? '<span>' + distStr + '</span><span class="dot">\\u00b7</span>' : '') +
              (p.type ? '<span>' + esc(p.type) + '</span>' : '') +
              (p.open_now === true ? '<span class="dot">\\u00b7</span><span class="open">Open</span>' : '') +
              (p.open_now === false ? '<span class="dot">\\u00b7</span><span class="closed">Closed</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card-score" style="background:' + scoreColor(p._overall) + '">' + Math.round(p._overall * 100) + '</div>' +
        '</div>' +
        '<div class="card-narrative">' + esc(p._narrative) + '</div>';

      // Photo strip
      if (p.photos && p.photos.length && DATA.apiKey) {
        var photoUrls = p.photos.map(function(ph) {
          return 'https://places.googleapis.com/v1/' + ph.ref + '/media?maxHeightPx=800&maxWidthPx=1200&key=' + DATA.apiKey;
        });
        var thumbs = photoUrls.slice(0, 4).map(function(url, pi) {
          return '<img src="' + url.replace('800','300').replace('1200','400') + '" loading="lazy" alt="" onclick="event.stopPropagation();openLightbox(' + JSON.stringify(photoUrls).replace(/"/g,'&quot;') + ',' + pi + ')">';
        }).join('');
        card.innerHTML += '<div class="photo-strip">' + thumbs + '</div>';
      }

      // Evidence excerpts from reviews
      if (p.evidence && p.evidence.length) {
        var evHtml = p.evidence.map(function(ev) {
          return '<div class="evidence-quote">"' + esc(ev.text) + '" <span class="ev-tag">' + ev.category + '</span></div>';
        }).join('');
        card.innerHTML += '<div class="evidence">' + evHtml + '</div>';
      }

      // Action links (website, social, food-specific)
      var links = [];
      if (p.website) links.push('<a class="action-link" href="' + esc(p.website) + '" target="_blank" onclick="event.stopPropagation()">Website \\u2197</a>');
      if (p.social_links && p.social_links.instagram) links.push('<a class="action-link" href="' + esc(p.social_links.instagram) + '" target="_blank" onclick="event.stopPropagation()">Instagram \\u2197</a>');
      if (p.social_links && p.social_links.facebook) links.push('<a class="action-link" href="' + esc(p.social_links.facebook) + '" target="_blank" onclick="event.stopPropagation()">Facebook \\u2197</a>');
      links.push('<a class="action-link" href="' + esc(mapsUrl) + '" target="_blank" onclick="event.stopPropagation()">Maps \\u2197</a>');

      card.innerHTML += '<div class="action-links">' + links.join('') + '</div>';
      card.innerHTML += '<div class="card-addr"><span>' + esc(p.address || '') + '</span></div>';

      content.appendChild(card);
    });
  });
}

function selectPlace(i) {
  selectedIndex = i;
  var p = DATA.scored[i];
  if (map && p.location) {
    map.panTo({ lat: p.location.lat, lng: p.location.lng });
    map.setZoom(15);
  }
  updateMarkers();
  render();
  var el = document.getElementById('place-' + i);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// === MAP ===
function initMap() {
  if (!DATA.apiKey || !DATA.locationBias) return;
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: DATA.locationBias.lat, lng: DATA.locationBias.lng },
    zoom: 13, disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy'
  });
  var bounds = new google.maps.LatLngBounds();
  DATA.scored.forEach(function(p, i) {
    if (!p.location) return;
    var pos = { lat: p.location.lat, lng: p.location.lng };
    bounds.extend(pos);
    var marker = new google.maps.Marker({
      position: pos, map: map, title: p.name,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: scoreColor(p._overall), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 10 },
      label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
      zIndex: Math.round(p._overall * 100)
    });
    marker.addListener('click', function() { selectPlace(i); });
    markers[i] = marker;
  });
  if (DATA.scored.length > 1) map.fitBounds(bounds, 40);
}

function updateMarkers() {
  markers.forEach(function(marker, i) {
    if (!marker) return;
    var p = DATA.scored[i];
    marker.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: scoreColor(p._overall), fillOpacity: 1,
      strokeColor: selectedIndex === i ? '#1a3a5c' : '#fff',
      strokeWeight: selectedIndex === i ? 3 : 2,
      scale: selectedIndex === i ? 14 : 10
    });
    marker.setZIndex(selectedIndex === i ? 999 : Math.round(p._overall * 100));
  });
}

// === GO ===
try { render(); } catch(e) {
  document.getElementById('content').innerHTML = '<div style="padding:20px;color:red">' + e.message + '<br><pre>' + e.stack + '</pre></div>';
}
</script>
${API_KEY ? `<script>
function onMapsLoaded() { try { initMap(); updateMarkers(); } catch(e) { console.error(e); } }
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=onMapsLoaded" async defer></script>` : ''}
</body>
</html>`;
}

// --- Output per-query HTML ---
const html = generateHTML(embeddedData);
const htmlOutFile = resolve(PLACES_DIR, slug + '.html');
writeFileSync(htmlOutFile, html);
console.error(`Written: ${htmlOutFile}`);

// Also write to the standard location for quick access
const latestFile = resolve(REPO_ROOT, 'trips', 'scored-places.html');
writeFileSync(latestFile, html);

// --- Generate root index page (home) ---
function generateHomePage(placeIndex) {
  // Scan for trip HTML pages
  const tripsDir = resolve(REPO_ROOT, 'trips');
  let tripFiles = [];
  try {
    const fs = require('fs');
    tripFiles = fs.readdirSync(tripsDir)
      .filter(f => f.endsWith('.html') && f !== 'scored-places.html')
      .map(f => {
        const content = fs.readFileSync(resolve(tripsDir, f), 'utf-8');
        const titleMatch = content.match(/<title>(.*?)<\/title>/);
        return { file: f, title: titleMatch ? titleMatch[1] : f.replace('.html', '') };
      });
  } catch {}

  const tripRows = tripFiles.map(t =>
    '<a href="trips/' + t.file + '" class="card">' +
      '<div class="card-top">' +
        '<div class="card-title">' + t.title.replace(/</g, '&lt;') + '</div>' +
        '<div class="card-arrow">&#8250;</div>' +
      '</div>' +
      '<div class="card-meta">Trip plan</div>' +
    '</a>'
  ).join('');

  const searchRows = placeIndex
    .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))
    .map(e => {
      const date = new Date(e.generated_at);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const intentChips = (e.intents || []).map(i =>
        '<span class="chip">' + i + '</span>'
      ).join(' ');
      return '<a href="trips/places/' + e.slug + '.html" class="card">' +
        '<div class="card-top">' +
          '<div class="card-title">' + (e.query || e.slug).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/near\s+/i, '<span class="card-loc">near </span>') + '</div>' +
          '<div class="card-arrow">&#8250;</div>' +
        '</div>' +
        '<div class="card-meta">' +
          dateStr + ' ' + timeStr +
          ' · ' + e.place_count + ' places' +
          (e.top_place ? ' · #1 ' + e.top_place.replace(/</g, '&lt;') : '') +
        '</div>' +
        '<div class="card-chips">' + intentChips + '</div>' +
      '</a>';
    }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TravelOptimizer</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:#f0f4f8;color:#1a2332;line-height:1.5}
.header{background:linear-gradient(135deg,#1a3a5c 0%,#2a6496 50%,#3a85c4 100%);color:#fff;padding:36px 16px 28px}
.header h1{font-size:24px;font-weight:700}
.header .sub{font-size:13px;color:#a8cce8;margin-top:4px}
.section{max-width:600px;margin:0 auto;padding:0 12px}
.section-title{font-size:13px;font-weight:700;color:#1a3a5c;text-transform:uppercase;letter-spacing:0.5px;padding:20px 4px 8px}
.card{display:block;background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.04);transition:transform 0.1s}
.card:active{transform:scale(0.98)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.card-title{font-size:14px;font-weight:600;color:#1a2332;flex:1}
.card-loc{color:#5a6b7d;font-weight:400}
.card-arrow{font-size:20px;color:#94a3b8;font-weight:300}
.card-meta{font-size:11px;color:#5a6b7d;margin-top:4px}
.card-chips{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;background:#eff6ff;color:#1e40af}
.footer{text-align:center;padding:32px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="header">
  <h1>TravelOptimizer</h1>
  <div class="sub">Niki, Carissa &amp; Ashi</div>
</div>
<div class="section">
${tripRows ? '<div class="section-title">Trip Plans</div>' + tripRows : ''}
<div class="section-title">Place Searches</div>
${searchRows || '<div style="padding:12px;font-size:13px;color:#94a3b8">No searches yet</div>'}
</div>
<div class="footer">TravelOptimizer</div>
</body>
</html>`;
}

// Re-read the index (it was just updated above)
let currentIndex = [];
try { currentIndex = JSON.parse(readFileSync(INDEX_FILE, 'utf-8')); } catch {}
const homeHtml = generateHomePage(currentIndex);
const homeFile = resolve(REPO_ROOT, 'index.html');
writeFileSync(homeFile, homeHtml);
console.error(`Home page: ${homeFile}`);

try {
  if (process.platform === 'darwin') execSync(`open "${htmlOutFile}"`);
  else execSync(`xdg-open "${htmlOutFile}"`);
  console.error('Opened in browser.');
} catch {}
